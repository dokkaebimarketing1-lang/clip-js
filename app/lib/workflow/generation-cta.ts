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
  if (!input.hasStoryboard) return {label: 'VLOG 구성', target: 'compose'};
  if (!input.creativeApproved) return {label: 'Creative 승인', target: 'creative'};
  if (!input.generationApproved) return {label: '생성 요청 검토', target: 'authorization'};
  if (!input.hasSubmittedGeneration) return {label: '승인된 영상 생성', target: 'submit'};
  return {label: '생성 상태 확인', target: 'jobs'};
};
