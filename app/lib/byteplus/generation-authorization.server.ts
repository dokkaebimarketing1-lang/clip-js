import {z} from 'zod';
import {computeGenerationRequestKey} from '@/app/lib/generation/generation-repository.server';
import {approveGeneration, computeStoryboardHash} from '@/app/lib/workflow/approval';
import {sha256} from '@/app/lib/workflow/hash';
import {characterSheetSchema} from '@/app/lib/workflow/schema';
import {getGeneratedAssetStore} from '@/app/lib/generation/runtime.server';
import {parseProjectState} from '@/app/lib/workflow/project-file';
import type {ProjectState} from '@/app/types';
import {signGenerationApproval, verifyCreativeApprovalSignature} from '@/app/lib/security/approval-signature';
import {
  BYTEPLUS_COMPILER_VERSION,
  BYTEPLUS_SEEDANCE_25_MODEL,
  compileBytePlusCanonicalRequest,
  computeBytePlusRequestHash,
  type BytePlusReferenceIdentity,
} from './byteplus-adapter';

export const BYTEPLUS_PROVIDER_API_VERSION = 'v3' as const;
export const BYTEPLUS_SEEDANCE_25_POLICY_VERSION = 'seedance-2.5-policy-2026-08-07' as const;

const attemptIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

export const generationAuthorizationPreviewSchema = z.object({
  authorizationVersion: z.literal(1),
  projectId: z.string().min(1).max(128),
  attemptId: attemptIdSchema,
  provider: z.literal('byteplus'),
  model: z.literal(BYTEPLUS_SEEDANCE_25_MODEL),
  providerApiVersion: z.literal(BYTEPLUS_PROVIDER_API_VERSION),
  compilerVersion: z.literal(BYTEPLUS_COMPILER_VERSION),
  policyVersion: z.literal(BYTEPLUS_SEEDANCE_25_POLICY_VERSION),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  requestKey: z.string().regex(/^[a-f0-9]{64}$/),
  task: z.enum(['t2v', 'r2v', 'edit', 'ext', 'fl']),
  duration: z.union([z.number().int().min(4).max(30), z.literal(-1)]),
  ratio: z.enum(['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']),
  resolution: z.enum(['480p', '720p']),
  generateAudio: z.boolean(),
  referenceCount: z.number().int().min(0).max(50),
  promptPreview: z.string().min(1).max(50_000),
}).strict();

export type GenerationAuthorizationPreview = z.infer<typeof generationAuthorizationPreviewSchema>;

const assertCurrentCreativeApproval = async (project: ProjectState): Promise<void> => {
  const approval = project.workflow.creativeApproval;
  if (!project.workflow.storyboard || approval.status !== 'approved' || !approval.storyboardHash) {
    throw new Error('Current storyboard requires owner creative approval.');
  }
  verifyCreativeApprovalSignature(project.id, approval);
  const currentHash = await computeStoryboardHash(project.workflow.storyboard);
  if (currentHash !== approval.storyboardHash) throw new Error('Creative approval is stale for the current storyboard.');

  const characterSheets = project.workflow.characterSheets?.length
    ? project.workflow.characterSheets
    : project.workflow.characterSheet ? [project.workflow.characterSheet] : [];
  if (characterSheets.length === 0 || !approval.characterSheetHash) {
    throw new Error('Current character sheets require owner creative approval.');
  }
  const characterIds = characterSheets.map((sheet) => sheet.id);
  if (new Set(characterIds).size !== characterIds.length) throw new Error('Character identities must be unique.');
  const referenceIds = characterSheets.map((sheet) => sheet.referenceImageId);
  if (referenceIds.some((id) => !id)) throw new Error('Every character requires a reference asset.');
  const readyReferenceIds = referenceIds as string[];
  const lineage = project.workflow.storyboard.characterReferenceIds;
  if (!lineage || lineage.length !== readyReferenceIds.length || lineage.some((id, index) => id !== readyReferenceIds[index])) {
    throw new Error('Storyboard reference lineage is missing or stale.');
  }
  const currentCharacterHash = await sha256(characterSheets.map((sheet) => characterSheetSchema.parse(sheet)));
  if (currentCharacterHash !== approval.characterSheetHash) throw new Error('Creative approval is stale for the current character sheets.');
  const assets = await Promise.all(readyReferenceIds.map((id) => getGeneratedAssetStore().get(id)));
  if (assets.some((asset) => !asset || asset.projectId !== project.id || asset.state !== 'ready' || !asset.mimeType.startsWith('image/'))) {
    throw new Error('A current character reference asset is missing or belongs to another project.');
  }
};

export const createGenerationAuthorizationPreview = async (
  projectInput: ProjectState,
  attemptIdInput: string,
  references: readonly BytePlusReferenceIdentity[] = [],
): Promise<GenerationAuthorizationPreview> => {
  const project = parseProjectState(projectInput);
  const attemptId = attemptIdSchema.parse(attemptIdInput);
  await assertCurrentCreativeApproval(project);
  if (!project.workflow.storyboard) throw new Error('Storyboard is required.');
  if (project.workflow.seedanceMaster.axes.task !== 't2v' || references.length !== 0) {
    throw new Error('The enabled paid canary slice permits reference-free t2v only.');
  }
  const canonical = compileBytePlusCanonicalRequest({
    storyboard: project.workflow.storyboard,
    production: project.workflow.production,
    settings: project.workflow.seedanceMaster,
    references: [...references],
  });
  const requestHash = await computeBytePlusRequestHash(canonical);
  return generationAuthorizationPreviewSchema.parse({
    authorizationVersion: 1,
    projectId: project.id,
    attemptId,
    provider: 'byteplus',
    model: canonical.model,
    providerApiVersion: BYTEPLUS_PROVIDER_API_VERSION,
    compilerVersion: BYTEPLUS_COMPILER_VERSION,
    policyVersion: BYTEPLUS_SEEDANCE_25_POLICY_VERSION,
    requestHash,
    requestKey: computeGenerationRequestKey(project.id, attemptId, requestHash),
    task: canonical.task,
    duration: canonical.duration,
    ratio: canonical.ratio,
    resolution: canonical.resolution,
    generateAudio: canonical.generateAudio,
    referenceCount: canonical.references.length,
    promptPreview: canonical.prompt,
  });
};

export const issueGenerationAuthorization = async (
  projectInput: ProjectState,
  attemptId: string,
  expectedRequestHash: string,
  approvedBy = 'project-owner',
  now = new Date(),
  references: readonly BytePlusReferenceIdentity[] = [],
) => {
  const project = parseProjectState(projectInput);
  const preview = await createGenerationAuthorizationPreview(project, attemptId, references);
  if (preview.requestHash !== expectedRequestHash) throw new Error('Generation request changed after preview; preview and approve again.');
  if (!project.workflow.storyboard) throw new Error('Storyboard is required.');
  const unsigned = await approveGeneration(
    project.workflow.storyboard,
    project.workflow.production,
    project.workflow.seedanceMaster,
    approvedBy,
    now,
    {
      projectId: project.id,
      attemptId: preview.attemptId,
      provider: 'byteplus',
      model: preview.model,
      providerApiVersion: preview.providerApiVersion,
      compilerVersion: preview.compilerVersion,
      policyVersion: preview.policyVersion,
      requestHash: preview.requestHash,
    },
  );
  return {
    preview,
    generationApproval: signGenerationApproval(project.id, unsigned),
  };
};
