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
