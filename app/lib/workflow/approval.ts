import {sha256} from './hash';
import {
  creativeApprovalSchema,
  generationApprovalSchema,
  seedanceMasterSettingsSchema,
  storyboardSchema,
  characterSheetSchema,
  type CharacterSheet,
  type CreativeApproval,
  type GenerationApproval,
  type ProductionManifest,
  type SeedanceMasterSettings,
  type Storyboard,
  type WorkflowState,
} from './schema';
import {createDefaultProductionManifest} from './production-schema';
import {buildDefaultSeedanceMasterSettings} from './seedance-master';
import {computeGenerationBlueprintHash, computeProductionInputHash} from './approval-v3';

export class ApprovalRequiredError extends Error {
  constructor(message = 'The exact current generation blueprint must be explicitly approved before video generation.') {
    super(message);
    this.name = 'ApprovalRequiredError';
  }
}

export const computeStoryboardHash = async (storyboard: Storyboard): Promise<string> =>
  sha256(storyboardSchema.parse(storyboard));

export const computeSeedanceMasterHash = async (settings: SeedanceMasterSettings): Promise<string> =>
  sha256(seedanceMasterSettingsSchema.parse(settings));

export const approveCreative = async (
  storyboard: Storyboard | undefined,
  approvedBy: string,
  now = new Date(),
  characterSheet?: CharacterSheet,
): Promise<CreativeApproval> => creativeApprovalSchema.parse({
  status: 'approved',
  storyboardHash: storyboard ? await computeStoryboardHash(storyboard) : undefined,
  characterSheetHash: characterSheet ? await sha256(characterSheetSchema.parse(characterSheet)) : undefined,
  approvedAt: now.toISOString(),
  approvedBy,
});

export type GenerationAuthorizationMetadata = {
  projectId: string;
  attemptId: string;
  provider: 'byteplus' | 'fake' | 'higgsfield';
  model: string;
  providerApiVersion: string;
  compilerVersion: string;
  policyVersion: string;
  requestHash: string;
};

export const approveGeneration = async (
  storyboard: Storyboard,
  production: ProductionManifest,
  seedanceMaster: SeedanceMasterSettings,
  approvedBy: string,
  now = new Date(),
  metadata?: GenerationAuthorizationMetadata,
): Promise<GenerationApproval> => {
  const generationBlueprintHash = await computeGenerationBlueprintHash(storyboard, production, seedanceMaster);
  const authorization = metadata ?? {
    projectId: 'test-project',
    attemptId: 'test-attempt',
    provider: 'fake' as const,
    model: 'fake-seedance-2.5',
    providerApiVersion: 'test-v1',
    compilerVersion: 'test-v1',
    policyVersion: 'test-v1',
    requestHash: generationBlueprintHash,
  };
  return generationApprovalSchema.parse({
    status: 'approved',
    authorizationVersion: 1,
    ...authorization,
    storyboardHash: await computeStoryboardHash(storyboard),
    productionInputHash: await computeProductionInputHash(production),
    seedanceMasterHash: await computeSeedanceMasterHash(seedanceMaster),
    generationBlueprintHash,
    approvedAt: now.toISOString(),
    approvedBy,
  });
};

export const approveWorkflowGeneration = async (
  storyboard: Storyboard,
  approvedBy: string,
  now = new Date(),
  production: ProductionManifest = createDefaultProductionManifest(),
  seedanceMaster: SeedanceMasterSettings = buildDefaultSeedanceMasterSettings(),
): Promise<{creativeApproval: CreativeApproval; generationApproval: GenerationApproval}> => ({
  creativeApproval: await approveCreative(storyboard, approvedBy, now),
  generationApproval: await approveGeneration(storyboard, production, seedanceMaster, approvedBy, now),
});

/** @deprecated Compatibility name; returns the split approval bundle. */
export const approveStoryboard = approveWorkflowGeneration;

export const invalidateApproval = <T extends {status: 'draft' | 'approved' | 'invalidated'}>(approval: T): T => ({
  ...approval,
  status: approval.status === 'draft' ? 'draft' : 'invalidated',
});

export const invalidateForCreativeChange = (workflow: WorkflowState): WorkflowState => ({
  ...workflow,
  creativeApproval: invalidateApproval(workflow.creativeApproval),
  generationApproval: invalidateApproval(workflow.generationApproval),
  releaseApproval: invalidateApproval(workflow.releaseApproval),
});

export const invalidateForGenerationChange = (workflow: WorkflowState): WorkflowState => ({
  ...workflow,
  generationApproval: invalidateApproval(workflow.generationApproval),
  releaseApproval: invalidateApproval(workflow.releaseApproval),
});

export const invalidateForReleaseChange = (workflow: WorkflowState): WorkflowState => ({
  ...workflow,
  releaseApproval: invalidateApproval(workflow.releaseApproval),
});

export const assertVideoGenerationAllowed = async (workflow: WorkflowState): Promise<void> => {
  const approval = workflow.generationApproval;
  if (!workflow.storyboard || approval.status !== 'approved' || !approval.generationBlueprintHash) {
    throw new ApprovalRequiredError();
  }
  const currentHash = await computeGenerationBlueprintHash(workflow.storyboard, workflow.production, workflow.seedanceMaster);
  if (currentHash !== approval.generationBlueprintHash) {
    throw new ApprovalRequiredError('Generation blueprint changed after approval; approve the current version again.');
  }
};
