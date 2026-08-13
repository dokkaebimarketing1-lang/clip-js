import type {ProjectWorkspaceId} from './project-workspace';
import type {CharacterSheet, InterviewBrief, Storyboard, StyleBible} from '@/app/lib/workflow/schema';
import {validateCharacterStyleLineage} from '@/app/lib/workflow/style-lineage';

export const areCharacterReferencesStyleLocked = (characterSheets: CharacterSheet[], styleBibleHash: string | undefined): boolean =>
  validateCharacterStyleLineage(characterSheets, styleBibleHash).valid;

export const isStoryboardBuiltFromCharacterReferences = (storyboard: Storyboard | undefined, characterSheets: CharacterSheet[], styleBibleHash?: string): boolean => {
  if (!storyboard?.characterReferenceIds || characterSheets.length === 0) return false;
  const current = characterSheets.map((sheet) => sheet.referenceImageId);
  return current.every(Boolean)
    && Boolean(styleBibleHash)
    && storyboard.styleBibleHash === styleBibleHash
    && areCharacterReferencesStyleLocked(characterSheets, styleBibleHash)
    && storyboard.characterReferenceIds.length === current.length
    && storyboard.characterReferenceIds.every((id, index) => id === current[index]);
};

type CreationProgressInput = {
  brief?: InterviewBrief;
  styleBible?: StyleBible;
  styleBibleHash?: string;
  characterSheets?: CharacterSheet[];
  hasStoryboard: boolean;
  workspace?: ProjectWorkspaceId;
};

type CreationProgress = {
  state: 'input-needed' | 'plan-complete' | 'character-image-needed' | 'style-review-needed' | 'character-ready';
  completedCount: number;
  nextWorkspace?: ProjectWorkspaceId;
  nextLabel: string;
};

export const deriveCreationProgress = ({brief, styleBible, styleBibleHash, characterSheets = [], hasStoryboard, workspace = 'interview'}: CreationProgressInput): CreationProgress => {
  if (!brief || characterSheets.length === 0) {
    return {state: 'input-needed', completedCount: 0, nextLabel: 'AI 기획 시작'};
  }
  if (workspace === 'interview') {
    return {state: 'plan-complete', completedCount: 3, nextWorkspace: 'reference', nextLabel: '캐릭터 기준 만들기'};
  }
  if (characterSheets.some((sheet) => !sheet.referenceImageId)) {
    return {state: 'character-image-needed', completedCount: 3, nextLabel: '캐릭터 기준 이미지 등록'};
  }
  if (!styleBible || !areCharacterReferencesStyleLocked(characterSheets, styleBibleHash)) {
    return {state: 'style-review-needed', completedCount: 3, nextLabel: '캐릭터 스타일 검수'};
  }
  return hasStoryboard
    ? {state: 'character-ready', completedCount: 5, nextWorkspace: 'storyboard', nextLabel: '스토리보드 검수하기'}
    : {state: 'character-ready', completedCount: 4, nextLabel: '스토리보드 생성하기'};
};
