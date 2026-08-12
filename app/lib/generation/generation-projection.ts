import type {GenerationRecord} from './generation-schema';

export const projectGenerationProjection = (record: GenerationRecord) => {
  const job = {...record.job} as Record<string, unknown>;
  delete job.authorizationRef;
  delete job.lease;
  delete job.resultTransportUrl;
  delete job.resultTransportCiphertext;
  delete job.lastError;
  delete job.error;
  return {
    requestKey: record.requestKey,
    revision: record.revision,
    claimStatus: record.claim.status,
    projectId: record.claim.projectId,
    attemptId: record.claim.attemptId,
    requestHash: record.claim.requestHash,
    job,
  };
};
