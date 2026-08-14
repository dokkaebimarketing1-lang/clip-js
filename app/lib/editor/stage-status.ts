import type {ProjectWorkspaceId} from './project-workspace';
import type {ProjectState} from '@/app/types';
import {isStoryboardBuiltFromCharacterReferences} from './creation-progress';
import {validateCharacterStyleLineage} from '@/app/lib/workflow/style-lineage';
import {computeStoryboardHash} from '@/app/lib/workflow/approval';
import {computeGenerationBlueprintHash, computeRenderInputHash} from '@/app/lib/workflow/approval-v3';
import {sha256} from '@/app/lib/workflow/hash';
import {characterSheetSchema} from '@/app/lib/workflow/schema';

type StageStatusInput = {
  workspace: ProjectWorkspaceId;
  project: ProjectState;
  hasSubmittedGeneration: boolean;
};

export type StageStepState = 'complete' | 'current' | 'waiting';

const characterSheetsFor = (project: ProjectState) =>
  project.workflow.characterSheets ?? (project.workflow.characterSheet ? [project.workflow.characterSheet] : []);

export const deriveStageStepStates = async ({workspace, project, hasSubmittedGeneration}: StageStatusInput): Promise<Record<string, StageStepState>> => {
  const workflow = project.workflow;
  const sheets = characterSheetsFor(project);
  const planningDraft = Boolean(workflow.interviewBrief);
  const planningApproved = planningDraft && workflow.planningStatus === 'approved';
  const lineage = validateCharacterStyleLineage(sheets, workflow.styleBibleHash);
  let styleBibleContentCurrent = false;
  if (workflow.styleBible && workflow.styleBibleHash) {
    try {
      styleBibleContentCurrent = await sha256(workflow.styleBible) === workflow.styleBibleHash;
    } catch {
      styleBibleContentCurrent = false;
    }
  }
  const hasStyleBible = Boolean(
    workflow.styleBible
    && workflow.styleBibleHash
    && styleBibleContentCurrent
    && lineage.valid
    && lineage.anchorReferenceImageId === workflow.styleBible.anchorReferenceImageId,
  );
  const allCharacterImages = sheets.length > 0 && sheets.every((sheet) => Boolean(sheet.referenceImageId));
  const hasStyleAnchor = hasStyleBible;
  const allCharactersLocked = hasStyleBible;
  const storyboardIsCurrent = isStoryboardBuiltFromCharacterReferences(workflow.storyboard, sheets, workflow.styleBibleHash);

  let creativeApproved = false;
  if (storyboardIsCurrent && workflow.storyboard && workflow.creativeApproval.status === 'approved') {
    try {
      const [storyboardHash, characterSheetHash] = await Promise.all([
        computeStoryboardHash(workflow.storyboard),
        sha256(sheets.map((sheet) => characterSheetSchema.parse(sheet))),
      ]);
      creativeApproved = workflow.creativeApproval.storyboardHash === storyboardHash
        && workflow.creativeApproval.characterSheetHash === characterSheetHash;
    } catch {
      creativeApproved = false;
    }
  }

  const hasGenerationSpecs = workflow.production.shotSpecs.length > 0;
  let generationApproved = false;
  if (creativeApproved && hasGenerationSpecs && workflow.storyboard && workflow.generationApproval.status === 'approved') {
    try {
      const blueprintHash = await computeGenerationBlueprintHash(workflow.storyboard, workflow.production, workflow.seedanceMaster);
      generationApproved = workflow.generationApproval.generationBlueprintHash === blueprintHash;
    } catch {
      generationApproved = false;
    }
  }

  const approvedTakes = workflow.production.takes.filter((take) => take.takeApproval.status === 'approved');
  const hasApprovedTake = approvedTakes.length > 0;
  const selectedApprovedTakeIds = new Set(approvedTakes.filter((take) => take.selected).map((take) => take.id));
  const hasApprovedTakeOnTimeline = project.mediaFiles.some((media) =>
    media.includeInMerge && Boolean(media.takeId) && selectedApprovedTakeIds.has(media.takeId ?? ''),
  );

  let releaseApproved = false;
  if (hasApprovedTakeOnTimeline && workflow.releaseApproval.status === 'approved' && workflow.releaseApproval.renderInputHash) {
    try {
      releaseApproved = workflow.releaseApproval.renderInputHash === await computeRenderInputHash(project);
    } catch {
      releaseApproved = false;
    }
  }

  const complete = new Set<string>();
  if (planningDraft) complete.add('idea');
  if (planningDraft) complete.add('planning-draft');
  if (planningApproved) complete.add('planning-approval');
  if (allCharacterImages) complete.add('character-images');
  if (hasStyleAnchor) complete.add('style-anchor');
  if (hasStyleBible) complete.add('style-bible');
  if (allCharactersLocked) complete.add('character-lock');
  if (storyboardIsCurrent) complete.add('storyboard');
  if (creativeApproved) complete.add('shot-review');
  if (creativeApproved) complete.add('creative-approval');
  if (generationApproved) complete.add('generation-spec');
  if (generationApproved) complete.add('generation-approval');
  if (generationApproved && hasSubmittedGeneration) complete.add('generation-job');
  if (hasApprovedTake) complete.add('take-review');
  if (hasApprovedTakeOnTimeline) complete.add('approved-take');
  if (hasApprovedTakeOnTimeline) complete.add('timeline');
  if (releaseApproved) complete.add('release-approval');

  const orderByWorkspace: Record<ProjectWorkspaceId, string[]> = {
    interview: ['idea', 'planning-draft', 'planning-approval'],
    reference: ['character-images', 'style-anchor', 'style-bible', 'character-lock'],
    storyboard: ['storyboard', 'shot-review', 'creative-approval'],
    generation: ['generation-spec', 'generation-approval', 'generation-job', 'take-review'],
    edit: ['approved-take', 'timeline', 'release-approval', 'render'],
  };
  const allIds = Object.values(orderByWorkspace).flat();
  const firstIncomplete = orderByWorkspace[workspace].find((id) => !complete.has(id));
  return Object.fromEntries(allIds.map((id) => [id, complete.has(id) ? 'complete' : id === firstIncomplete ? 'current' : 'waiting']));
};

export const titleByWorkspace: Record<ProjectWorkspaceId, string> = {
  interview: '기획 결정',
  reference: '캐릭터·화풍 확정',
  storyboard: '콘티 검수·전체 승인',
  generation: '생성 실행·결과 검수',
  edit: '편집·최종 출력',
};
