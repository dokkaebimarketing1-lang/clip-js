import {NextResponse} from 'next/server';
import {deriveInterviewBrief, deriveCharacterSheet} from '@/app/lib/generation/interview-agent.server';
import {buildStoryboardFromBrief} from '@/app/lib/generation/storyboard-from-brief.server';
import {axesFromBrief, buildDefaultSeedanceMasterSettings, seedanceMasterSettingsSchema} from '@/app/lib/workflow/seedance-master';
import {interviewBriefSchema, characterSheetSchema, storyboardSchema} from '@/app/lib/workflow/schema';

/**
 * VLOG 파이프라인 8단계 · 통합 컴포즈 엔드포인트
 *
 * 한 문장 → ② 인터뷰 → ③ 이미지 콘티(fake 플레이스홀더) → ④ 캐릭터 시트
 * → ⑥ 스토리보드 → ⑦ 28축 → ⑧ 프롬프트 미리보기
 *
 * ③ 이미지 콘티: 실제 이미지 모델 호출은 canary까지 비활성. 이 구현은
 * 스토리보드 샷마다 placeholder 마커만 생성한다 (fail-closed).
 */
export const POST = async (request: Request) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({error: 'invalid json'}, {status: 400});
  }
  const sentence = (body as {sentence?: unknown})?.sentence;
  if (typeof sentence !== 'string' || sentence.trim().length === 0) {
    return NextResponse.json({error: 'sentence required'}, {status: 400});
  }

  const brief = deriveInterviewBrief(sentence);
  const sheet = deriveCharacterSheet(brief);
  const storyboard = buildStoryboardFromBrief(brief);
  const axes = axesFromBrief(brief, sheet);
  const seedanceMaster = seedanceMasterSettingsSchema.parse({
    ...buildDefaultSeedanceMasterSettings(),
    axes,
    duration: brief.durationSeconds,
  });

  const imageStoryboard = storyboard.cuts.flatMap((cut) =>
    cut.shots.map((shot) => ({
      cutId: cut.id,
      shotId: shot.id,
      placeholder: `[IMAGE CONTI FAKE] ${cut.title} · ${shot.action}`,
    })),
  );

  return NextResponse.json({
    stage: 'compose-preview',
    interviewBrief: interviewBriefSchema.parse(brief),
    characterSheet: characterSheetSchema.parse(sheet),
    storyboard: storyboardSchema.parse(storyboard),
    imageStoryboard,
    seedanceMaster,
  });
};
