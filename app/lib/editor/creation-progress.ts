import type {ProjectWorkspaceId} from './project-workspace';
import type {CharacterSheet, InterviewBrief} from '@/app/lib/workflow/schema';

type CreationProgressInput = {
  brief?: InterviewBrief;
  characterSheet?: CharacterSheet;
  hasStoryboard: boolean;
  workspace?: ProjectWorkspaceId;
};

type CreationProgress = {
  state: 'input-needed' | 'plan-complete' | 'character-image-needed' | 'character-ready';
  completedCount: number;
  nextWorkspace?: ProjectWorkspaceId;
  nextLabel: string;
};

export const deriveCreationProgress = ({brief, characterSheet, hasStoryboard, workspace = 'interview'}: CreationProgressInput): CreationProgress => {
  if (!brief || !characterSheet || !hasStoryboard) {
    return {state: 'input-needed', completedCount: 0, nextLabel: 'AI 기획 시작'};
  }
  if (workspace === 'interview') {
    return {state: 'plan-complete', completedCount: 3, nextWorkspace: 'reference', nextLabel: '캐릭터 기준 만들기'};
  }
  if (!characterSheet.referenceImageId) {
    return {state: 'character-image-needed', completedCount: 3, nextLabel: '캐릭터 기준 이미지 등록'};
  }
  return {state: 'character-ready', completedCount: 4, nextWorkspace: 'storyboard', nextLabel: '스토리보드 검수하기'};
};
