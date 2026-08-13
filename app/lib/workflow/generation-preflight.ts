import type {ProjectState} from '@/app/types';

export type GenerationPreflightCheckId = 'storyboard' | 'frames' | 'production' | 'creative-approval' | 'canary-shape';

export type GenerationPreflightCheck = {
  id: GenerationPreflightCheckId;
  label: string;
  passed: boolean;
  detail: string;
};

export type GenerationPreflight = {
  checks: GenerationPreflightCheck[];
  missingFrameCutIds: string[];
  readyForAuthorization: boolean;
  providerSubmitEnabled: boolean;
};

export const deriveGenerationPreflight = (project: ProjectState, providerSubmitEnabled: boolean): GenerationPreflight => {
  const storyboard = project.workflow.storyboard;
  const missingFrameCutIds = storyboard?.cuts.filter((cut) => !cut.startFrameAssetId || !cut.endFrameAssetId).map((cut) => cut.id) ?? [];
  const hasStoryboard = Boolean(storyboard?.cuts.length);
  const hasProduction = project.workflow.production.shotSpecs.length > 0
    && Boolean(storyboard?.cuts.every((cut) => cut.shots.every((shot) => project.workflow.production.shotSpecs.some((spec) => spec.cutId === cut.id && spec.shotId === shot.id))));
  const creativeApproved = project.workflow.creativeApproval.status === 'approved';
  const settings = project.workflow.seedanceMaster;
  const isCanaryShape = settings.axes.task === 't2v' && settings.duration === 20 && project.aspectRatio === '16:9' && settings.resolution === '480p';
  const checks: GenerationPreflightCheck[] = [
    {id: 'storyboard', label: '스토리보드', passed: hasStoryboard, detail: hasStoryboard ? `${storyboard!.cuts.length}개 컷 구성 완료` : '모든 캐릭터 기준 이미지가 준비되면 기준 시트에서 스토리보드를 생성하세요.'},
    {id: 'frames', label: '컷 시작·끝 프레임', passed: hasStoryboard && missingFrameCutIds.length === 0, detail: missingFrameCutIds.length ? `${missingFrameCutIds.join(', ')} 프레임 미등록` : '모든 컷의 시작·끝 프레임이 자산으로 연결됨'},
    {id: 'production', label: '생성 명세', passed: hasProduction, detail: hasProduction ? `${project.workflow.production.shotSpecs.length}개 shot spec 연결 완료` : '스토리보드와 일치하는 shot spec이 필요합니다.'},
    {id: 'creative-approval', label: 'Creative 승인', passed: creativeApproved, detail: creativeApproved ? '현재 승인 상태가 유지됨' : '현재 스토리보드와 자산을 승인해야 합니다.'},
    {id: 'canary-shape', label: '카나리 규격', passed: isCanaryShape, detail: isCanaryShape ? '20초 · 480p · 16:9 · T2V' : '20초 · 480p · 16:9 · T2V로 맞춰야 합니다.'},
  ];
  return {
    checks,
    missingFrameCutIds,
    readyForAuthorization: checks.every((check) => check.passed),
    providerSubmitEnabled,
  };
};
