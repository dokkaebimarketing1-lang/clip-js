import {createHash} from 'node:crypto';

import type {GenerationRecord} from './generation-schema';
import type {FilesystemGenerationRepository} from './generation-repository.server';
import type {GenerationProviderClient, NormalizedProviderTask} from './provider';
import {openTransportUrl, sealTransportUrl} from './transport-seal.server';

export type IngestGenerationResult = (input: {
  projectId: string;
  requestKey: string;
  providerJobId: string;
  resultTransportUrl: string;
  authorizedDuration: 20 | 30;
  authorizedResolution: '480p' | '720p';
  authorizedGenerateAudio: boolean;
  signal?: AbortSignal;
}) => Promise<{assetId: string; contentSha256: string; actualDurationSeconds: number}>;

type Repository = FilesystemGenerationRepository;

type WorkerOptions = {
  repository: Repository;
  provider: GenerationProviderClient;
  workerId: string;
  ingestResult: IngestGenerationResult;
  now?: Date;
  leaseMs?: number;
  pollIntervalMs?: number;
  ingestRetryMs?: number;
  staleSubmittingMs?: number;
  signal?: AbortSignal;
};

const releaseLease = (lease: NonNullable<GenerationRecord['job']['lease']>, now: Date) => ({...lease, expiresAt: now.toISOString()});
const later = (now: Date, milliseconds: number) => new Date(now.getTime() + milliseconds).toISOString();
const takeIdFor = (requestKey: string) => `take_${createHash('sha256').update(`take:${requestKey}`).digest('hex').slice(0, 32)}`;

const updateJob = async (
  repository: Repository,
  requestKey: string,
  fencingToken: number,
  mutate: (record: GenerationRecord) => GenerationRecord['job'],
): Promise<GenerationRecord> => repository.updateWithFence(requestKey, fencingToken, (record) => ({...record, job: mutate(record)}));

const terminalJob = (
  record: GenerationRecord,
  task: Extract<NormalizedProviderTask, {status: 'failed' | 'cancelled' | 'expired'}>,
  now: Date,
) => ({
  ...record.job,
  status: task.status,
  providerJobId: task.providerJobId,
  updatedAt: now.toISOString(),
  lastError: task.error,
  lastErrorStage: task.status === 'failed' ? 'poll' as const : undefined,
  nextPollAt: undefined,
  lease: record.job.lease ? releaseLease(record.job.lease, now) : undefined,
}) as GenerationRecord['job'];

export const runGenerationWorkerTick = async (options: WorkerOptions): Promise<{processed: number}> => {
  const now = options.now ?? new Date();
  const leaseMs = options.leaseMs ?? 10 * 60_000;
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const ingestRetryMs = options.ingestRetryMs ?? 60_000;
  const staleSubmittingMs = options.staleSubmittingMs ?? 5 * 60_000;
  let processed = 0;
  const records = await options.repository.listAll();

  for (const listed of records) {
    options.signal?.throwIfAborted();
    if (listed.job.status === 'submitting') {
      if (now.getTime() - new Date(listed.job.updatedAt).getTime() >= staleSubmittingMs) {
        await options.repository.markUncertain(listed.requestKey, 'Submission did not reach a durable provider receipt.', now);
        processed += 1;
      }
      continue;
    }
    if (listed.job.nextPollAt && new Date(listed.job.nextPollAt).getTime() > now.getTime()) continue;
    if (!['queued', 'running', 'provider_succeeded', 'ingesting', 'ingest_failed'].includes(listed.job.status)) continue;
    const lease = await options.repository.acquireLease(listed.requestKey, options.workerId, now, leaseMs);
    if (!lease) continue;
    const current = await options.repository.get(listed.requestKey);
    if (!current || !['queued', 'running', 'provider_succeeded', 'ingesting', 'ingest_failed'].includes(current.job.status)) continue;
    processed += 1;

    let resultCiphertext = 'resultTransportCiphertext' in current.job ? current.job.resultTransportCiphertext : undefined;
    let resultUrl = resultCiphertext ? openTransportUrl(resultCiphertext) : undefined;
    let providerJobId = 'providerJobId' in current.job ? current.job.providerJobId : undefined;

    if (current.job.status === 'queued' || current.job.status === 'running') {
      if (!providerJobId) throw new Error('Pollable generation job is missing providerJobId.');
      const task = await options.provider.retrieveTask(providerJobId, options.signal);
      if (task.status === 'queued' || task.status === 'running') {
        await updateJob(options.repository, listed.requestKey, lease.fencingToken, (record) => ({
          ...record.job,
          status: task.status,
          providerJobId: task.providerJobId,
          updatedAt: now.toISOString(),
          nextPollAt: later(now, pollIntervalMs),
          lease: record.job.lease ? releaseLease(record.job.lease, now) : undefined,
        }) as GenerationRecord['job']);
        continue;
      }
      if (task.status === 'failed' || task.status === 'cancelled' || task.status === 'expired') {
        await updateJob(options.repository, listed.requestKey, lease.fencingToken, (record) => terminalJob(record, task, now));
        continue;
      }
      if (task.status !== 'succeeded') throw new Error(`Unsupported provider task state: ${task.status}`);
      resultUrl = task.resultTransportUrl;
      resultCiphertext = sealTransportUrl(task.resultTransportUrl);
      providerJobId = task.providerJobId;
      await updateJob(options.repository, listed.requestKey, lease.fencingToken, (record) => ({
        ...record.job,
        status: 'provider_succeeded',
        providerJobId: task.providerJobId,
        resultTransportCiphertext: resultCiphertext,
        updatedAt: now.toISOString(),
        lease: record.job.lease,
      }) as GenerationRecord['job']);
    }

    if (!resultUrl || !providerJobId) {
      await updateJob(options.repository, listed.requestKey, lease.fencingToken, (record) => ({
        ...record.job,
        status: 'ingest_failed',
        providerJobId: providerJobId ?? ('providerJobId' in record.job ? record.job.providerJobId : 'unknown'),
        resultTransportCiphertext: resultCiphertext,
        updatedAt: now.toISOString(),
        lastError: 'Provider success response did not include a result URL.',
        lastErrorStage: 'ingest',
        nextPollAt: later(now, ingestRetryMs),
        lease: record.job.lease ? releaseLease(record.job.lease, now) : undefined,
      }) as GenerationRecord['job']);
      continue;
    }

    await updateJob(options.repository, listed.requestKey, lease.fencingToken, (record) => ({
      ...record.job,
      status: 'ingesting',
      providerJobId: providerJobId!,
      resultTransportCiphertext: resultCiphertext,
      updatedAt: now.toISOString(),
      lease: record.job.lease,
    }) as GenerationRecord['job']);

    try {
      const ingested = await options.ingestResult({
        projectId: current.claim.projectId,
        requestKey: listed.requestKey,
        providerJobId,
        resultTransportUrl: resultUrl,
        authorizedDuration: current.job.authorizedDuration,
        authorizedResolution: current.job.authorizedResolution,
        authorizedGenerateAudio: current.job.authorizedGenerateAudio,
        signal: options.signal,
      });
      await updateJob(options.repository, listed.requestKey, lease.fencingToken, (record) => ({
        ...record.job,
        status: 'ready',
        providerJobId: providerJobId!,
        assetId: ingested.assetId,
        contentSha256: ingested.contentSha256,
        actualDurationSeconds: ingested.actualDurationSeconds,
        takeId: takeIdFor(listed.requestKey),
        qcStatus: 'qc_pending',
        updatedAt: now.toISOString(),
        nextPollAt: undefined,
        lastError: undefined,
        lastErrorStage: undefined,
        lease: record.job.lease ? releaseLease(record.job.lease, now) : undefined,
      }) as GenerationRecord['job']);
    } catch (error) {
      await updateJob(options.repository, listed.requestKey, lease.fencingToken, (record) => ({
        ...record.job,
        status: 'ingest_failed',
        providerJobId: providerJobId!,
        resultTransportCiphertext: resultCiphertext,
        updatedAt: now.toISOString(),
        lastError: error instanceof Error ? error.message : 'Generated result ingestion failed.',
        lastErrorStage: 'ingest',
        nextPollAt: later(now, ingestRetryMs),
        lease: record.job.lease ? releaseLease(record.job.lease, now) : undefined,
      }) as GenerationRecord['job']);
    }
  }
  return {processed};
};
