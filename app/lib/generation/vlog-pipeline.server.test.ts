import {describe, expect, it} from 'vitest';
import {deriveInterviewBrief, deriveCharacterSheet} from './interview-agent.server';
import {buildStoryboardFromBrief} from './storyboard-from-brief.server';
import {storyboardSchema} from '@/app/lib/workflow/schema';
import {axesFromBrief, seedanceMasterSettingsSchema, buildDefaultSeedanceMasterSettings} from '@/app/lib/workflow/seedance-master';

describe('VLOG 파이프라인 ⑥⑦ — brief→스토리보드→28축', () => {
  const brief = deriveInterviewBrief('고양이와 인사하는 30초 VLOG 만들어줘');
  const sheet = deriveCharacterSheet(brief);

  it('brief에서 4단계 아크 스토리보드를 조립한다', () => {
    const storyboard = buildStoryboardFromBrief(brief);
    expect(storyboardSchema.safeParse(storyboard).success).toBe(true);
    expect(storyboard.cuts).toHaveLength(3);
    expect(storyboard.cuts.map((c) => c.title)).toEqual(['Opening', 'Development', 'Turn']);
    expect(storyboard.cuts[2].shots[0].dialogue).toContain('인사');
  });

  it('brief 기반 28축 axes가 유효한 설정 스키마를 통과한다', () => {
    const axes = axesFromBrief(brief, sheet);
    const settings = seedanceMasterSettingsSchema.parse({
      ...buildDefaultSeedanceMasterSettings(),
      axes,
      duration: 30,
    });
    expect(settings.axes.camera).toBe('vlog');
    expect(settings.axes.visualStyle).toBe('vlog');
    expect(settings.axes.durationStructure).toBe('30s-5stage');
  });

  it('강아지 brief는 vlog 스타일이지만 문서풍이 아니다', () => {
    const dogBrief = deriveInterviewBrief('강아지와 인사하는 20초 브이로그');
    const dogAxes = axesFromBrief(dogBrief);
    expect(dogAxes.durationStructure).toBe('20s-4stage');
    expect(dogAxes.camera).toBe('vlog');
  });

  it('미지정 주체는 documentary/cinematic 스타일로 fallback한다', () => {
    const plain = deriveInterviewBrief('인사하는 VLOG 만들어줘');
    const plainAxes = axesFromBrief(plain);
    expect(plainAxes.camera).toBe('cinematic');
    expect(plainAxes.visualStyle).toBe('documentary');
  });
});
