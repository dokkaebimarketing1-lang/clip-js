import {sha256} from './hash';
import {storyboardSchema, type ProductionManifest, type Storyboard, type StoryboardApproval, type WorkflowState} from './schema';
import {computeProductionHash} from './production';
import {createDefaultProductionManifest} from './production-schema';

export class ApprovalRequiredError extends Error {
  constructor(message = 'The exact current storyboard must be explicitly approved before video generation.') {
    super(message);
    this.name = 'ApprovalRequiredError';
  }
}

export const computeStoryboardHash = async (storyboard: Storyboard): Promise<string> =>
  sha256(storyboardSchema.parse(storyboard));

export const approveStoryboard = async (
  storyboard: Storyboard,
  approvedBy: string,
  now = new Date(),
  production: ProductionManifest = createDefaultProductionManifest(),
): Promise<StoryboardApproval> => ({
  status: 'approved',
  storyboardHash: await computeStoryboardHash(storyboard),
  productionHash: await computeProductionHash(production),
  approvedAt: now.toISOString(),
  approvedBy,
});

export const invalidateApproval = (approval: StoryboardApproval): StoryboardApproval => ({
  ...approval,
  status: approval.status === 'draft' ? 'draft' : 'invalidated',
});

export const assertVideoGenerationAllowed = async (workflow: WorkflowState): Promise<void> => {
  if (!workflow.storyboard || workflow.approval.status !== 'approved' || !workflow.approval.storyboardHash || !workflow.approval.productionHash) {
    throw new ApprovalRequiredError();
  }
  const currentHash = await computeStoryboardHash(workflow.storyboard);
  if (currentHash !== workflow.approval.storyboardHash) {
    throw new ApprovalRequiredError('Storyboard changed after approval; approve the current version again.');
  }
  const currentProductionHash = await computeProductionHash(workflow.production);
  if (currentProductionHash !== workflow.approval.productionHash) {
    throw new ApprovalRequiredError('Production manifest changed after approval; approve the current version again.');
  }
};
