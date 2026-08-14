import type {ProjectState} from '@/app/types';
import {deriveStageStepStates} from './stage-status';

export type ProjectCardProgress = {percent: number; label: string};

const stageGates: Array<{gate: string; label: string}> = [
  {gate: 'planning-approval', label: '기획 확정'},
  {gate: 'character-lock', label: '캐릭터·스타일'},
  {gate: 'creative-approval', label: '콘티·승인'},
  {gate: 'take-review', label: '생성·검수'},
  {gate: 'release-approval', label: '편집·출력'},
];

export const deriveProjectCardProgress = async (project: ProjectState): Promise<ProjectCardProgress> => {
  const states = await deriveStageStepStates({
      workspace: 'interview',
      project,
      hasSubmittedGeneration: project.workflow.production.takes.length > 0,
  });
  const firstIncomplete = stageGates.findIndex(({gate}) => states[gate] !== 'complete');
  const completeCount = firstIncomplete === -1 ? stageGates.length : firstIncomplete;
  return {
    percent: completeCount * 20,
    label: completeCount === stageGates.length ? '출력 승인 완료' : stageGates[completeCount].label,
  };
};
