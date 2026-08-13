import {NextResponse} from 'next/server';
import {z} from 'zod';
import {getConfiguredPlanningProvider} from '@/app/lib/generation/planning-runtime.server';
import {getGeneratedAssetStore} from '@/app/lib/generation/runtime.server';
import {characterSheetSchema, interviewBriefSchema, storyboardSchema} from '@/app/lib/workflow/schema';

const inputSchema = z.object({
  projectId: z.string().min(1).max(128),
  sentence: z.string().trim().min(1).max(2000),
  interviewBrief: interviewBriefSchema,
  characterSheets: z.array(characterSheetSchema.extend({
    id: z.string().regex(/^CHAR\d{2}$/),
    referenceImageId: z.string().regex(/^ga_[a-f0-9]{32}$/),
  })).min(1).max(10),
}).strict();

export const POST = async (request: Request) => {
  let raw: unknown;
  try {
    raw = await request.json();
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
  const assets = await Promise.all(input.characterSheets.map((sheet) =>
    getGeneratedAssetStore().get(sheet.referenceImageId),
  ));
  const ownsEveryImage = assets.every((asset) =>
    asset?.projectId === input.projectId && asset.mimeType.startsWith('image/'),
  );
  if (!ownsEveryImage) {
    return NextResponse.json({
      error: '현재 프로젝트에 연결된 캐릭터 기준 이미지를 찾을 수 없습니다.',
      code: 'CHARACTER_REFERENCE_NOT_FOUND',
    }, {status: 409});
  }

  try {
    const provider = getConfiguredPlanningProvider();
    const plan = await provider.compose(input.sentence, request.signal);
    const storyboard = storyboardSchema.parse(plan.storyboard);
    const validIds = new Set(input.characterSheets.map((sheet) => sheet.id));
    if (storyboard.cuts.some((cut) => cut.characterIds?.some((id) => !validIds.has(id)))) {
      throw new Error('Storyboard referenced an unknown character.');
    }
    const allCharacterIds = input.characterSheets.map((sheet) => sheet.id);
    const linkedStoryboard = storyboardSchema.parse({
      ...storyboard,
      characterReferenceIds: input.characterSheets.map((sheet) => sheet.referenceImageId),
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
