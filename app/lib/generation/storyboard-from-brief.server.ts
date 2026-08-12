import type {InterviewBrief, Storyboard} from '@/app/lib/workflow/schema';
import {storyboardSchema} from '@/app/lib/workflow/schema';

/**
 * VLOG 파이프라인 8단계 · 단계 ⑥ (스토리보드 조립)
 *
 * 인터뷰 brief에서 4단계 아크(Opening→Development→Turn→Ending) 기반
 * 샷 구성을 생성한다. 실제 운영에서는 storyboard-v2 스킬이 이미지 콘티(③)를
 * 먼저 만들고 이 함수가 그 텍스트 구조를 조립하지만, 이 구현은 텍스트 스토리보드를
 * 규칙 기반으로 합성한다 (canary 전 fake).
 *
 * fail-closed: 외부 모델 호출 없음.
 */
export const buildStoryboardFromBrief = (brief: InterviewBrief): Storyboard => {
  const total = brief.durationSeconds;
  const third = Math.round(total / 3);
  const greeting = brief.greetingLine || `${brief.subject}와 인사하는 순간`;

  return storyboardSchema.parse({
    version: 'v1',
    title: `${brief.subject} ${brief.action}`,
    noBgm: true,
    cuts: [
      {
        id: 'CUT01',
        title: 'Opening',
        absoluteStartSeconds: 0,
        absoluteEndSeconds: third,
        shots: [{
          id: 'S1',
          startSeconds: 0,
          endSeconds: third,
          startFrame: '주인공 등장',
          endFrame: '카메라 응시',
          camera: 'eye',
          action: `${brief.subject}가 화면에 들어와 카메라를 바라봄`,
          dialogue: '—',
          sfx: 'ambience',
        }],
      },
      {
        id: 'CUT02',
        title: 'Development',
        absoluteStartSeconds: third,
        absoluteEndSeconds: third * 2,
        shots: [{
          id: 'S1',
          startSeconds: third,
          endSeconds: third * 2,
          startFrame: '카메라 응시',
          endFrame: '앞발 흔들기',
          camera: 'eye',
          action: `${brief.subject}가 다가와 가까워지며 몸을 살짝 기움`,
          dialogue: '—',
          sfx: 'soft-step',
        }],
      },
      {
        id: 'CUT03',
        title: 'Turn',
        absoluteStartSeconds: third * 2,
        absoluteEndSeconds: total,
        shots: [{
          id: 'S1',
          startSeconds: third * 2,
          endSeconds: total,
          startFrame: '앞발 흔들기',
          endFrame: '인사 마무리',
          camera: 'eye',
          action: `${brief.subject}가 앞발을 살짝 흔들며 인사함`,
          dialogue: greeting,
          sfx: 'chime',
        }],
      },
    ],
  });
};
