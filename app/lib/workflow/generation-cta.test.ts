import {describe, expect, it} from 'vitest';
import {deriveGenerationCtaState} from './generation-cta';

describe('deriveGenerationCtaState', () => {
  it.each([
    [{hasStoryboard: false, creativeApproved: false, generationApproved: false, hasSubmittedGeneration: false}, {label: 'VLOG 구성', target: 'compose'}],
    [{hasStoryboard: true, creativeApproved: false, generationApproved: false, hasSubmittedGeneration: false}, {label: 'Creative 승인', target: 'creative'}],
    [{hasStoryboard: true, creativeApproved: true, generationApproved: false, hasSubmittedGeneration: false}, {label: '생성 요청 검토', target: 'authorization'}],
    [{hasStoryboard: true, creativeApproved: true, generationApproved: true, hasSubmittedGeneration: false}, {label: '승인된 영상 생성', target: 'submit'}],
    [{hasStoryboard: true, creativeApproved: true, generationApproved: true, hasSubmittedGeneration: true}, {label: '생성 상태 확인', target: 'jobs'}],
  ] as const)('maps workflow state %# to the next safe action', (input, expected) => {
    expect(deriveGenerationCtaState(input)).toEqual(expected);
  });
});
