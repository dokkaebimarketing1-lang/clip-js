import type {ProjectState, MediaFile} from '@/app/types';
import {invalidateForReleaseChange} from './approval';
import {
  generationTakeSchema,
  productionManifestSchema,
  takeApprovalSchema,
  type GenerationTake,
  type TakeApproval,
} from './production-schema';
import type {GenerationRecord} from '@/app/lib/generation/generation-schema';

type ReadyJob = Extract<GenerationRecord['job'], {status: 'ready'}>;
export type ReadyGenerationCandidate = {
  requestKey: string;
  claim: {projectId: string; attemptId: string; requestHash: string};
  job: Pick<ReadyJob, 'status' | 'takeId' | 'assetId' | 'contentSha256' | 'authorizedResolution' | 'providerJobId' | 'model' | 'updatedAt' | 'takeScope' | 'targetShotSpecId' | 'authorizationRef' | 'provider'>;
};

const managedMode = (task: ProjectState['workflow']['seedanceMaster']['axes']['task']): GenerationTake['mode'] => {
  if (task === 't2v') return 't2v';
  if (task === 'r2v') return 'omni_reference';
  if (task === 'edit') return 'video_edit';
  if (task === 'ext') return 'video_extension';
  return 'first_last_frame';
};

export const upsertQcPendingTake = (project: ProjectState, record: ReadyGenerationCandidate | GenerationRecord): ProjectState => {
  const job = record.job;
  if (record.claim.projectId !== project.id || job.status !== 'ready') throw new Error('Ready generation record does not belong to this project.');
  const existing = project.workflow.production.takes.find((take) => take.id === job.takeId);
  if (existing) {
    if (existing.outputAssetId !== job.assetId || existing.contentSha256 !== job.contentSha256 || existing.requestKey !== record.requestKey) {
      throw new Error('Existing Take identity conflicts with the ready generation record.');
    }
    return project;
  }
  const authorization = project.workflow.generationApproval;
  if (authorization.status !== 'approved' || !authorization.productionInputHash || !authorization.requestHash || !authorization.generationBlueprintHash) {
    throw new Error('Ready generation import requires the authorized production blueprint.');
  }
  if (!authorization.attemptId || !authorization.signature
    || record.claim.attemptId !== authorization.attemptId
    || record.claim.requestHash !== authorization.requestHash
    || job.authorizationRef !== authorization.signature
    || job.provider !== authorization.provider
    || job.model !== authorization.model) {
    throw new Error('Ready generation authorization lineage does not match the current signed authorization.');
  }
  if (job.takeScope === 'shot' && (!job.targetShotSpecId || !project.workflow.production.shotSpecs.some((shot) => shot.id === job.targetShotSpecId))) {
    throw new Error('Shot-scoped generation is missing its authorized shotSpecId.');
  }
  const take = generationTakeSchema.parse({
    id: job.takeId,
    scope: job.takeScope,
    shotSpecId: job.targetShotSpecId,
    mode: managedMode(project.workflow.seedanceMaster.axes.task),
    resolution: job.authorizedResolution,
    extensionMode: project.workflow.seedanceMaster.extensionMode,
    structuredSpecHash: authorization.productionInputHash,
    compiledPromptHash: authorization.requestHash,
    assetBundleHash: job.contentSha256,
    continuityLockHash: authorization.generationBlueprintHash,
    provider: 'byteplus',
    model: job.model,
    providerJobId: job.providerJobId,
    requestKey: record.requestKey,
    outputAssetId: job.assetId,
    contentSha256: job.contentSha256,
    qcStatus: 'qc_pending',
    takeApproval: {status: 'draft'},
    verdict: 'pending',
    selected: false,
    createdAt: job.updatedAt,
  });
  return {
    ...project,
    workflow: invalidateForReleaseChange({
      ...project.workflow,
      production: productionManifestSchema.parse({...project.workflow.production, takes: [...project.workflow.production.takes, take]}),
    }),
  };
};

const takePosition = (project: ProjectState, take: GenerationTake): number => {
  const spec = project.workflow.production.shotSpecs.find((shot) => shot.id === take.shotSpecId);
  const cut = project.workflow.storyboard?.cuts.find((candidate) => candidate.id === spec?.cutId);
  const shot = cut?.shots.find((candidate) => candidate.id === spec?.shotId);
  return cut && shot ? cut.absoluteStartSeconds + shot.startSeconds : 0;
};

export const prepareApprovedTakeImport = (
  project: ProjectState,
  takeId: string,
  approvalInput: TakeApproval,
  durationSeconds: number,
): ProjectState => {
  const approval = takeApprovalSchema.parse(approvalInput);
  if (approval.status !== 'approved' || !approval.takeId || !approval.assetId || !approval.contentSha256 || !approval.signature) {
    throw new Error('A server-signed Take approval is required.');
  }
  const take = project.workflow.production.takes.find((candidate) => candidate.id === takeId);
  if (!take || take.id !== approval.takeId || take.outputAssetId !== approval.assetId || take.contentSha256 !== approval.contentSha256) {
    throw new Error('Take approval identity does not match the qc_pending Take.');
  }
  const existingMedia = project.mediaFiles.find((media) => media.takeId === take.id);
  if (take.qcStatus === 'approved') {
    if (!existingMedia || take.takeApproval.signature !== approval.signature
      || existingMedia.generatedAssetId !== approval.assetId || existingMedia.contentSha256 !== approval.contentSha256) {
      throw new Error('Existing approved Take import conflicts with the signed approval.');
    }
    return project;
  }
  if (take.qcStatus !== 'qc_pending') throw new Error('Only a qc_pending Take can be approved for import.');
  const approvedTake = generationTakeSchema.parse({...take, qcStatus: 'approved', takeApproval: approval, verdict: 'accepted', selected: true});
  const takes = project.workflow.production.takes.map((candidate) => candidate.id === take.id
    ? approvedTake
    : (candidate.scope === 'production' && take.scope === 'production')
      || (candidate.scope === 'shot' && take.scope === 'shot' && candidate.shotSpecId === take.shotSpecId)
      ? {...candidate, selected: false}
      : candidate);
  if (existingMedia) {
    if (existingMedia.generatedAssetId !== approval.assetId || existingMedia.contentSha256 !== approval.contentSha256) throw new Error('Existing timeline placement conflicts with Take approval.');
    return {...project, workflow: invalidateForReleaseChange({...project.workflow, production: productionManifestSchema.parse({...project.workflow.production, takes})})};
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 32) throw new Error('Approved Take duration is invalid.');
  const positionStart = takePosition(project, take);
  const shotSpec = project.workflow.production.shotSpecs.find((shot) => shot.id === take.shotSpecId);
  const mediaId = `media_${take.id}`.slice(0, 128);
  const media: MediaFile = {
    id: mediaId,
    fileName: `${take.id}.mp4`,
    source: {kind: 'generated', generatedAssetId: approval.assetId},
    generatedAssetId: approval.assetId,
    contentSha256: approval.contentSha256,
    takeId: take.id,
    cutId: shotSpec?.cutId,
    shotId: shotSpec?.shotId,
    type: 'video',
    startTime: 0,
    endTime: durationSeconds,
    positionStart,
    positionEnd: positionStart + durationSeconds,
    includeInMerge: true,
    playbackSpeed: 1,
    volume: 100,
    zIndex: 1,
    opacity: 100,
    provider: 'byteplus',
    model: take.model,
    jobId: take.providerJobId,
    storyboardRole: 'clip',
  };
  const storyboard = project.workflow.storyboard ? structuredClone(project.workflow.storyboard) : undefined;
  const cut = storyboard?.cuts.find((candidate) => candidate.id === shotSpec?.cutId);
  if (cut) cut.generatedTakeIds = Array.from(new Set([...(cut.generatedTakeIds ?? []), take.id]));
  return {
    ...project,
    mediaFiles: [...project.mediaFiles, media],
    duration: Math.max(project.duration, media.positionEnd),
    workflow: invalidateForReleaseChange({...project.workflow, storyboard, production: productionManifestSchema.parse({...project.workflow.production, takes})}),
  };
};
