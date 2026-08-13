import {NextResponse} from 'next/server';
import {z} from 'zod';
import {getConfiguredPlanningProvider} from '@/app/lib/generation/planning-runtime.server';
import {getGeneratedAssetStore} from '@/app/lib/generation/runtime.server';
import {characterSheetSchema, interviewBriefSchema, storyboardSchema, styleBibleSchema} from '@/app/lib/workflow/schema';
import {sha256} from '@/app/lib/workflow/hash';
import {validateCharacterStyleLineage} from '@/app/lib/workflow/style-lineage';

const MAX_BODY_BYTES = 64 * 1024;

const assertSameOrigin = (request: Request) => {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite !== 'same-origin' || origin !== new URL(request.url).origin) {
    throw new Error('Browser same-origin context is required.');
  }
};

const readBody = async (request: Request): Promise<unknown> => {
  const type = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (!type.startsWith('application/json')) throw new Error('JSON required.');
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new Error('Request too large.');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new Error('Request too large.');
  return JSON.parse(text);
};

const inputSchema = z.object({
  projectId: z.string().min(1).max(128),
  sentence: z.string().trim().min(1).max(2000),
  interviewBrief: interviewBriefSchema,
  styleBible: styleBibleSchema,
  styleBibleHash: z.string().regex(/^[a-f0-9]{64}$/),
  characterSheets: z.array(characterSheetSchema.extend({
    id: z.string().regex(/^CHAR\d{2}$/),
    referenceImageId: z.string().regex(/^ga_[a-f0-9]{32}$/),
    referenceStyleHash: z.string().regex(/^[a-f0-9]{64}$/),
  })).min(1).max(10),
}).strict();

export const POST = async (request: Request) => {
  let raw: unknown;
  try {
    assertSameOrigin(request);
    raw = await readBody(request);
  } catch {
    return NextResponse.json({error: '잘못된 요청입니다.', code: 'INVALID_REQUEST'}, {status: 400});
  }
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({
      error: '모든 캐릭터 기준 이미지를 준비한 뒤 스토리보드를 생성하세요.',
      code: 'CHARACTER_REFERENCES_REQUIRED',
    }, {status: 409});
  }

  const input = parsed.data;
  const characterIds = input.characterSheets.map((sheet) => sheet.id);
  if (new Set(characterIds).size !== characterIds.length) {
    return NextResponse.json({error: '캐릭터 식별자가 중복됐습니다.', code: 'DUPLICATE_CHARACTER_ID'}, {status: 409});
  }
  if (await sha256(input.styleBible) !== input.styleBibleHash
    || !validateCharacterStyleLineage(input.characterSheets, input.styleBibleHash).valid) {
    return NextResponse.json({error: '캐릭터 기준 이미지의 공통 스타일이 확정되지 않았습니다.', code: 'STYLE_LINEAGE_REQUIRED'}, {status: 409});
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
    return asset?.projectId === input.projectId && asset.state === 'ready' && asset.mimeType.startsWith('image/') && assetLineageMatches;
  });
  if (!ownsEveryImage) {
    return NextResponse.json({
      error: '현재 프로젝트에 연결된 캐릭터 기준 이미지를 찾을 수 없습니다.',
      code: 'CHARACTER_REFERENCE_NOT_FOUND',
    }, {status: 409});
  }

  try {
    const provider = getConfiguredPlanningProvider();
    const lockedPlanningInput = [
      input.sentence,
      '[PROJECT STYLE BIBLE — IMMUTABLE FOR EVERY CHARACTER AND SHOT]',
      JSON.stringify(input.styleBible),
      '[CHARACTER MASTER IDENTITIES — DO NOT CHANGE DESIGN]',
      JSON.stringify(input.characterSheets.map(({id, name, breed, palette, visualTags, referenceImageId}) => ({id, name, breed, palette, visualTags, referenceImageId}))),
      'Every cut must preserve this exact project style and use only the listed character IDs. Change camera/action only; never reinterpret medium, realism, anatomy, lighting, palette language, or character identity.',
    ].join('\n');
    const plan = await provider.compose(provider.provider === 'rules' ? input.sentence : lockedPlanningInput, request.signal);
    const storyboard = storyboardSchema.parse(plan.storyboard);
    const validIds = new Set(input.characterSheets.map((sheet) => sheet.id));
    if (storyboard.cuts.some((cut) => cut.characterIds?.some((id) => !validIds.has(id)))) {
      throw new Error('Storyboard referenced an unknown character.');
    }
    const allCharacterIds = input.characterSheets.map((sheet) => sheet.id);
    const linkedStoryboard = storyboardSchema.parse({
      ...storyboard,
      characterReferenceIds: input.characterSheets.map((sheet) => sheet.referenceImageId),
      styleBibleHash: input.styleBibleHash,
      cuts: storyboard.cuts.map((cut) => ({
        ...cut,
        characterIds: cut.characterIds?.length ? cut.characterIds : allCharacterIds,
      })),
    });
    return NextResponse.json({stage: 'storyboard-ready', storyboard: linkedStoryboard});
  } catch (error) {
    console.error('Storyboard generation failed.', {name: error instanceof Error ? error.name : 'UnknownError'});
    return NextResponse.json({
      error: '스토리보드를 생성하지 못했습니다.',
      code: 'STORYBOARD_GENERATION_FAILED',
    }, {status: 503});
  }
};
