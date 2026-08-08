import {sha256} from './hash';
import {
  seedanceMasterSettingsSchema,
  storyboardSchema,
  type ProductionManifest,
  type SeedanceMasterSettings,
  type Storyboard,
  type StoryboardApproval,
  type WorkflowState,
} from './schema';
import {computeProductionHash} from './production';
import {createDefaultProductionManifest} from './production-schema';
import {buildDefaultSeedanceMasterSettings} from './seedance-master';

export class ApprovalRequiredError extends Error {
  constructor(message = 'The exact current storyboard, production manifest, and Seedance Master settings must be explicitly approved before video generation.') {
    super(message);
    this.name = 'ApprovalRequiredError';
  }
}

export const computeStoryboardHash = async (storyboard: Storyboard): Promise<string> =>
  sha256(storyboardSchema.parse(storyboard));

export const computeSeedanceMasterHash = async (settings: SeedanceMasterSettings): Promise<string> =>
  sha256(seedanceMasterSettingsSchema.parse(settings));

export const approveStoryboard = async (
  storyboard: Storyboard,
  approvedBy: string,
  now = new Date(),
  production: ProductionManifest = createDefaultProductionManifest(),
  seedanceMaster: SeedanceMasterSettings = buildDefaultSeedanceMasterSettings(),
): Promise<StoryboardApproval> => ({
  status: 'approved',
  storyboardHash: await computeStoryboardHash(storyboard),
  productionHash: await computeProductionHash(production),
  seedanceMasterHash: await computeSeedanceMasterHash(seedanceMaster),
  approvedAt: now.toISOString(),
  approvedBy,
});

export const invalidateApproval = (approval: StoryboardApproval): StoryboardApproval => ({
  ...approval,
  status: approval.status === 'draft' ? 'draft' : 'invalidated',
});

export const assertVideoGenerationAllowed = async (workflow: WorkflowState): Promise<void> => {
  const approval = workflow.approval;
  if (!workflow.storyboard || approval.status !== 'approved' || !approval.storyboardHash || !approval.productionHash || !approval.seedanceMasterHash) {
    throw new ApprovalRequiredError();
  }
  const currentHash = await computeStoryboardHash(workflow.storyboard);
  if (currentHash !== approval.storyboardHash) {
    throw new ApprovalRequiredError('Storyboard changed after approval; approve the current version again.');
  }
  const currentProductionHash = await computeProductionHash(workflow.production);
  if (currentProductionHash !== approval.productionHash) {
    throw new ApprovalRequiredError('Production manifest changed after approval; approve the current version again.');
  }
  const currentSeedanceMasterHash = await computeSeedanceMasterHash(workflow.seedanceMaster);
  if (currentSeedanceMasterHash !== approval.seedanceMasterHash) {
    throw new ApprovalRequiredError('Seedance Master changed after approval; approve the current version again.');
  }
};
