import {
  characterSheetSchema,
  interviewBriefSchema,

  styleBibleSchema,
  workflowStateSchema,
  type CharacterSheet,
  type InterviewBrief,

  type StyleBible,
  type WorkflowState,
} from './schema';
import {seedanceMasterSettingsSchema, type SeedanceMasterSettings} from './seedance-master';

export type PlanningInstallCommand = {
  expectedWorkflow: WorkflowState;
  interviewBrief: InterviewBrief;
  styleBible: StyleBible;
  styleBibleHash?: string;
  characterSheets: CharacterSheet[];
  seedanceMaster: SeedanceMasterSettings;
};

export const preparePlanningInstallCommand = ({
  expectedWorkflow,
  interviewBrief,
  styleBible,
  styleBibleHash,
  characterSheets,
  seedanceMaster,
}: {
  expectedWorkflow: WorkflowState;
  interviewBrief: unknown;
  styleBible: unknown;
  styleBibleHash?: unknown;
  characterSheets: unknown[];
  seedanceMaster: unknown;
}): PlanningInstallCommand => ({
  expectedWorkflow: workflowStateSchema.parse(expectedWorkflow),
  interviewBrief: interviewBriefSchema.parse(interviewBrief),
  styleBible: styleBibleSchema.parse(styleBible),
  styleBibleHash: typeof styleBibleHash === 'string' ? styleBibleHash : undefined,
  characterSheets: characterSheets.map((sheet) => characterSheetSchema.parse(sheet)),
  seedanceMaster: seedanceMasterSettingsSchema.parse(seedanceMaster),
});

export const isPlanningRequestCurrent = (current: WorkflowState, expected: WorkflowState) =>
  JSON.stringify(workflowStateSchema.parse(current)) === JSON.stringify(workflowStateSchema.parse(expected));
