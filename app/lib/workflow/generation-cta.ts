export type GenerationCtaTarget = 'compose' | 'creative' | 'authorization' | 'submit' | 'jobs';

export type GenerationCtaInput = {
  hasStoryboard: boolean;
  creativeApproved: boolean;
  generationApproved: boolean;
  hasSubmittedGeneration: boolean;
};

export type GenerationCtaState = {
  label: string;
  target: GenerationCtaTarget;
};

export const deriveGenerationCtaState = (input: GenerationCtaInput): GenerationCtaState => {
  if (!input.hasStoryboard) return {label: '콘티 만들기', target: 'compose'};
  if (!input.creativeApproved) return {label: '콘티 전체 승인', target: 'creative'};
  if (!input.generationApproved) return {label: '사양·비용 확인', target: 'authorization'};
  if (!input.hasSubmittedGeneration) return {label: '승인 내용으로 유료 생성', target: 'submit'};
  return {label: '생성 상태 확인', target: 'jobs'};
};
