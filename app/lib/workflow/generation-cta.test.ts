import {describe, expect, it} from 'vitest';
import {deriveGenerationCtaState} from './generation-cta';

describe('deriveGenerationCtaState', () => {
  it.each([
    [{hasStoryboard: false, creativeApproved: false, generationApproved: false, hasSubmittedGeneration: false}, {label: '콘티 만들기', target: 'compose'}],
    [{hasStoryboard: true, creativeApproved: false, generationApproved: false, hasSubmittedGeneration: false}, {label: '콘티 전체 승인', target: 'creative'}],
    [{hasStoryboard: true, creativeApproved: true, generationApproved: false, hasSubmittedGeneration: false}, {label: '사양·비용 확인', target: 'authorization'}],
    [{hasStoryboard: true, creativeApproved: true, generationApproved: true, hasSubmittedGeneration: false}, {label: '승인 내용으로 유료 생성', target: 'submit'}],
    [{hasStoryboard: true, creativeApproved: true, generationApproved: true, hasSubmittedGeneration: true}, {label: '생성 상태 확인', target: 'jobs'}],
  ] as const)('maps workflow state %# to the next safe action', (input, expected) => {
    expect(deriveGenerationCtaState(input)).toEqual(expected);
  });
});
