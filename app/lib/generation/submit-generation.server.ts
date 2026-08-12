import {parseProjectState} from '@/app/lib/workflow/project-file';
import {verifyGenerationApprovalSignature} from '@/app/lib/security/approval-signature';
import {
  compileBytePlusCanonicalRequest,
  computeBytePlusRequestHash,
  materializeBytePlusCreateTaskRequest,
  type BytePlusReferenceIdentity,
} from '@/app/lib/byteplus/byteplus-adapter';
import {createGenerationAuthorizationPreview} from '@/app/lib/byteplus/generation-authorization.server';
import type {ProjectState} from '@/app/types';
import type {FilesystemGenerationRepository} from './generation-repository.server';
import type {GenerationProviderClient} from './provider';

export type SubmitAuthorizedGenerationOptions = {
  project: ProjectState;
  repository: FilesystemGenerationRepository;
  provider: GenerationProviderClient;
  allowProviderSubmit: boolean;
  references?: readonly BytePlusReferenceIdentity[];
  resolveTransportUrl?: (reference: BytePlusReferenceIdentity) => Promise<string>;
  now?: Date;
  signal?: AbortSignal;
};

export const submitAuthorizedGeneration = async (options: SubmitAuthorizedGenerationOptions) => {
  const project = parseProjectState(options.project);
  const authorization = project.workflow.generationApproval;
  verifyGenerationApprovalSignature(project.id, authorization);
  if (authorization.provider !== 'byteplus' || !authorization.attemptId || !authorization.requestHash || !authorization.signature) {
    throw new Error('A signed BytePlus GenerationAuthorization is required.');
  }
  const references = [...(options.references ?? [])];
  const preview = await createGenerationAuthorizationPreview(project, authorization.attemptId, references);
  if (preview.requestHash !== authorization.requestHash
    || preview.projectId !== authorization.projectId
    || preview.model !== authorization.model
    || preview.providerApiVersion !== authorization.providerApiVersion
    || preview.compilerVersion !== authorization.compilerVersion
    || preview.policyVersion !== authorization.policyVersion) {
    throw new Error('GenerationAuthorization does not match the current canonical provider request.');
  }
  if (!project.workflow.storyboard) throw new Error('Storyboard is required.');
  const canonical = compileBytePlusCanonicalRequest({
    storyboard: project.workflow.storyboard,
    production: project.workflow.production,
    settings: project.workflow.seedanceMaster,
    references,
  });
  if (await computeBytePlusRequestHash(canonical) !== preview.requestHash) throw new Error('Canonical request hash mismatch.');
  const payload = await materializeBytePlusCreateTaskRequest(canonical, async (reference) => {
    if (!options.resolveTransportUrl) throw new Error('Reference transport resolver is unavailable.');
    return options.resolveTransportUrl(reference);
  });
  if (!options.allowProviderSubmit) throw new Error('BytePlus provider submission is disabled.');
  if (canonical.task !== 't2v' || references.length !== 0 || (canonical.duration !== 20 && canonical.duration !== 30)) {
    throw new Error('The enabled BytePlus submission slice permits reference-free 20s or 30s t2v only.');
  }

  const claimed = await options.repository.claimSubmission({
    projectId: project.id,
    attemptId: authorization.attemptId,
    requestKey: preview.requestKey,
    requestHash: preview.requestHash,
    provider: 'byteplus',
    model: preview.model,
    authorizedDuration: canonical.duration,
    authorizedResolution: canonical.resolution,
    authorizedGenerateAudio: canonical.generateAudio,
    takeScope: 'production',
    authorizationRef: authorization.signature,
  }, options.now);
  if (!claimed.created) return {record: claimed.record, reused: true, request: payload};

  let providerJobId: string | undefined;
  try {
    ({providerJobId} = await options.provider.createTask(payload, options.signal));
    const record = await options.repository.recordProviderReceipt(preview.requestKey, providerJobId, options.now);
    return {record, reused: false, request: payload};
  } catch (error) {
    try {
      await options.repository.markUncertain(preview.requestKey, error instanceof Error ? error.message : 'Provider submission outcome is uncertain.', providerJobId, options.now);
    } catch {
      // A persisted `submitting` record is also non-replayable. Reconciliation will lock it as uncertain.
    }
    throw error;
  }
};
