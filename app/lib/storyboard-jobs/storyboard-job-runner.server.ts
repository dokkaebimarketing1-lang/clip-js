import {randomUUID} from 'node:crypto';
import {getConfiguredPlanningProvider} from '@/app/lib/generation/planning-runtime.server';
import {getGeneratedAssetStore} from '@/app/lib/generation/runtime.server';
import {storyboardSchema} from '@/app/lib/workflow/schema';
import {sha256} from '@/app/lib/workflow/hash';
import {validateCharacterStyleLineage} from '@/app/lib/workflow/style-lineage';
import {getStoryboardJobRepository} from './runtime.server';
import type {StoryboardJobInput, StoryboardJobRecord} from './storyboard-job-schema';

export class StoryboardInputNotReadyError extends Error {
  readonly code: 'STYLE_LINEAGE_REQUIRED' | 'CHARACTER_REFERENCE_NOT_FOUND' | 'DUPLICATE_CHARACTER_ID';

  constructor(code: StoryboardInputNotReadyError['code'], message: string) {
    super(message);
    this.name = 'StoryboardInputNotReadyError';
    this.code = code;
  }
}

export const assertStoryboardInputReady = async (input: StoryboardJobInput): Promise<void> => {
  const characterIds = input.characterSheets.map((sheet) => sheet.id);
  if (new Set(characterIds).size !== characterIds.length) {
    throw new StoryboardInputNotReadyError('DUPLICATE_CHARACTER_ID', '캐릭터 식별자가 중복됐습니다.');
  }
  if (await sha256(input.styleBible) !== input.styleBibleHash
    || !validateCharacterStyleLineage(input.characterSheets, input.styleBibleHash).valid) {
    throw new StoryboardInputNotReadyError('STYLE_LINEAGE_REQUIRED', '캐릭터 기준 이미지의 공통 스타일이 확정되지 않았습니다.');
  }
  const assets = await Promise.all(input.characterSheets.map((sheet) =>
    getGeneratedAssetStore().get(sheet.referenceImageId),
  ));
  const ownsEveryImage = assets.every((asset, index) => {
    const sheet = input.characterSheets[index];
    const expectedReferences = sheet.styleReferenceImageIds ?? [];
    const assetLineageMatches = asset?.styleLineage?.styleBibleHash === input.styleBibleHash
      && asset.styleLineage.styleReferenceImageIds.length === expectedReferences.length
      && asset.styleLineage.styleReferenceImageIds.every((id, referenceIndex) => id === expectedReferences[referenceIndex]);
    return asset?.projectId === input.projectId
      && asset.state === 'ready'
      && asset.mimeType.startsWith('image/')
      && assetLineageMatches;
  });
  if (!ownsEveryImage) {
    throw new StoryboardInputNotReadyError('CHARACTER_REFERENCE_NOT_FOUND', '현재 프로젝트에 연결된 캐릭터 기준 이미지를 찾을 수 없습니다.');
  }
};

const generateStoryboard = async (input: StoryboardJobInput) => {
  const provider = getConfiguredPlanningProvider();
  const lockedPlanningInput = [
    input.sentence,
    '[PROJECT STYLE BIBLE — IMMUTABLE FOR EVERY CHARACTER AND SHOT]',
    JSON.stringify(input.styleBible),
    '[CHARACTER MASTER IDENTITIES — DO NOT CHANGE DESIGN]',
    JSON.stringify(input.characterSheets.map(({id, name, breed, palette, visualTags, referenceImageId}) => ({id, name, breed, palette, visualTags, referenceImageId}))),
    'Every cut must preserve this exact project style and use only the listed character IDs. Change camera/action only; never reinterpret medium, realism, anatomy, lighting, palette language, or character identity.',
  ].join('\n');
  const signal = AbortSignal.timeout(240_000);
  const plan = await provider.compose(provider.provider === 'rules' ? input.sentence : lockedPlanningInput, signal);
  const storyboard = storyboardSchema.parse(plan.storyboard);
  const validIds = new Set(input.characterSheets.map((sheet) => sheet.id));
  if (storyboard.cuts.some((cut) => cut.characterIds?.some((id) => !validIds.has(id)))) {
    throw new Error('Storyboard referenced an unknown character.');
  }
  const allCharacterIds = input.characterSheets.map((sheet) => sheet.id);
  return storyboardSchema.parse({
    ...storyboard,
    characterReferenceIds: input.characterSheets.map((sheet) => sheet.referenceImageId),
    styleBibleHash: input.styleBibleHash,
    cuts: storyboard.cuts.map((cut) => ({
      ...cut,
      characterIds: cut.characterIds?.length ? cut.characterIds : allCharacterIds,
    })),
  });
};

export const runStoryboardJob = async (jobId: string): Promise<StoryboardJobRecord | undefined> => {
  const repository = getStoryboardJobRepository();
  const beforeClaim = await repository.get(jobId);
  if (!beforeClaim || beforeClaim.status === 'completed' || beforeClaim.status === 'failed') return beforeClaim;
  if (beforeClaim.status === 'processing' && beforeClaim.lease) {
    if (new Date(beforeClaim.lease.expiresAt).getTime() > Date.now()) return beforeClaim;
    return repository.fail(
      jobId,
      beforeClaim.lease.token,
      '서버 연결이 중단되어 작업 결과를 확정할 수 없습니다. 중복 실행을 막기 위해 자동 재시도하지 않았습니다.',
    );
  }
  const claimed = await repository.claim(jobId, `storyboard-${randomUUID()}`);
  if (!claimed?.lease) return repository.get(jobId);
  const token = claimed.lease.token;
  try {
    await assertStoryboardInputReady(claimed.input);
    const storyboard = await generateStoryboard(claimed.input);
    return await repository.complete(jobId, token, storyboard);
  } catch (error) {
    console.error('Storyboard generation failed.', {name: error instanceof Error ? error.name : 'UnknownError'});
    const message = error instanceof StoryboardInputNotReadyError
      ? error.message
      : '스토리보드를 생성하지 못했습니다.';
    return repository.fail(jobId, token, message);
  }
};
