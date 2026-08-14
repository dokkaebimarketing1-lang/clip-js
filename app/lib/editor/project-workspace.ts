export type ProjectWorkspaceId = 'interview' | 'reference' | 'storyboard' | 'generation' | 'edit';

export const PROJECT_WORKSPACES: ReadonlyArray<{
  id: ProjectWorkspaceId;
  label: string;
  shortLabel: string;
  step: number;
}> = [
  {id: 'interview', label: '기획', shortLabel: '기획', step: 1},
  {id: 'reference', label: '캐릭터·스타일', shortLabel: '기준', step: 2},
  {id: 'storyboard', label: '콘티·승인', shortLabel: '콘티', step: 3},
  {id: 'generation', label: '생성·검수', shortLabel: '생성', step: 4},
  {id: 'edit', label: '편집·출력', shortLabel: '편집', step: 5},
];

export const getProjectWorkspaceLayout = (workspace: ProjectWorkspaceId) => ({
  showSources: workspace === 'edit',
  showTimeline: workspace === 'edit',
});

export const getInitialProjectWorkspace = ({
  planningApproved,
  hasStoryboard,
}: {
  planningApproved: boolean;
  hasStoryboard: boolean;
}): ProjectWorkspaceId => {
  if (!planningApproved) return 'interview';
  return hasStoryboard ? 'storyboard' : 'reference';
};

export type WorkspaceInternalStep = {
  id: string;
  label: string;
};

const INTERNAL_STEPS: Record<ProjectWorkspaceId, ReadonlyArray<WorkspaceInternalStep>> = {
  interview: [
    {id: 'idea', label: '아이디어 입력'},
    {id: 'planning-draft', label: 'AI 기획 초안'},
    {id: 'planning-approval', label: '기획 확정'},
  ],
  reference: [
    {id: 'character-images', label: '기준 이미지'},
    {id: 'style-anchor', label: '화풍 영향 확인'},
    {id: 'style-bible', label: 'Style Bible·기준 화풍 확정'},
    {id: 'character-lock', label: '전체 캐릭터 확정'},
  ],
  storyboard: [
    {id: 'storyboard', label: '콘티 생성'},
    {id: 'shot-review', label: '컷·샷 검수'},
    {id: 'creative-approval', label: '콘티 전체 승인'},
  ],
  generation: [
    {id: 'generation-spec', label: '생성 사양·비용'},
    {id: 'generation-approval', label: '생성 실행 승인'},
    {id: 'generation-job', label: '유료 제출'},
    {id: 'take-review', label: '결과 승인·반려'},
  ],
  edit: [
    {id: 'approved-take', label: '승인 생성본 배치'},
    {id: 'timeline', label: '타임라인 편집'},
    {id: 'release-approval', label: '최종 출력 승인'},
    {id: 'render', label: '최종 렌더'},
  ],
};

export const getWorkspaceInternalSteps = (workspace: ProjectWorkspaceId) => INTERNAL_STEPS[workspace];

export const shouldShowSampleMedia = ({sampleMode, mediaCount}: {sampleMode: boolean; mediaCount: number}) =>
  sampleMode && mediaCount === 0;
