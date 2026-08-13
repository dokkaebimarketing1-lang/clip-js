export type ProjectWorkspaceId = 'interview' | 'reference' | 'storyboard' | 'generation' | 'edit';

export const PROJECT_WORKSPACES: ReadonlyArray<{
  id: ProjectWorkspaceId;
  label: string;
  shortLabel: string;
  step: number;
}> = [
  {id: 'interview', label: '인터뷰', shortLabel: '대화', step: 1},
  {id: 'reference', label: '기준 시트', shortLabel: '시트', step: 2},
  {id: 'storyboard', label: '스토리보드', shortLabel: '콘티', step: 3},
  {id: 'generation', label: '영상 생성', shortLabel: '생성', step: 4},
  {id: 'edit', label: '편집', shortLabel: '편집', step: 5},
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
    {id: 'sentence', label: '문장 해석'},
    {id: 'interview', label: 'AI 인터뷰'},
  ],
  reference: [
    {id: 'image-storyboard', label: '이미지 콘티'},
    {id: 'character', label: '캐릭터 기준'},
    {id: 'reference-approval', label: '기준 승인'},
  ],
  storyboard: [
    {id: 'storyboard', label: '스토리보드'},
    {id: 'direction', label: '연출 상세'},
    {id: 'prompt-review', label: '프롬프트 검수'},
  ],
  generation: [
    {id: 'generation-approval', label: '생성 승인'},
    {id: 'paid-submit', label: '유료 제출'},
  ],
  edit: [
    {id: 'takes', label: '생성본 선택'},
    {id: 'timeline', label: '타임라인 편집'},
    {id: 'render', label: '최종 렌더'},
  ],
};

export const getWorkspaceInternalSteps = (workspace: ProjectWorkspaceId) => INTERNAL_STEPS[workspace];

export const shouldShowSampleMedia = ({sampleMode, mediaCount}: {sampleMode: boolean; mediaCount: number}) =>
  sampleMode && mediaCount === 0;
