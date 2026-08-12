import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
vi.mock('server-only', () => ({}));
import {createFilesystemGenerationRepository, computeGenerationRequestKey} from './generation-repository.server';
import {runGenerationWorkerTick} from './generation-worker.server';
import type {GenerationProviderClient} from './provider';
import {sealTransportUrl} from './transport-seal.server';

const dirs: string[] = [];
const root = () => { const value = mkdtempSync(join(tmpdir(), 'clipjs-worker-')); dirs.push(value); return value; };
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, {recursive: true, force: true})));

const claim = async () => {
  const repo = createFilesystemGenerationRepository({rootDirectory: root()});
  const requestHash = 'a'.repeat(64);
  const requestKey = computeGenerationRequestKey('project-1', 'attempt-1', requestHash);
  await repo.claimSubmission({projectId: 'project-1', attemptId: 'attempt-1', requestHash, requestKey, provider: 'byteplus', model: 'dreamina-seedance-2-5-260628', authorizationRef: 'b'.repeat(64)}, new Date('2026-08-11T00:00:00Z'));
  await repo.recordProviderReceipt(requestKey, 'provider-job-1', new Date('2026-08-11T00:00:01Z'));
  return {repo, requestKey};
};

describe('lease generation worker', () => {
  it('lets only one competing worker poll and ingests a succeeded result exactly once', async () => {
    const {repo, requestKey} = await claim();
    let polls = 0;
    let ingests = 0;
    const provider: GenerationProviderClient = {
      createTask: async () => { throw new Error('not used'); },
      retrieveTask: async () => {
        polls += 1;
        return {status: 'succeeded', providerJobId: 'provider-job-1', resultTransportUrl: 'https://results.example.com/output.mp4'};
      },
    };
    const ingestResult = async () => {
      ingests += 1;
      return {assetId: 'ga_' + 'c'.repeat(32), contentSha256: 'd'.repeat(64), actualDurationSeconds: 30};
    };
    const now = new Date('2026-08-11T00:01:00Z');
    await Promise.all([
      runGenerationWorkerTick({repository: repo, provider, workerId: 'worker-a', now, ingestResult}),
      runGenerationWorkerTick({repository: repo, provider, workerId: 'worker-b', now, ingestResult}),
    ]);
    const record = await repo.get(requestKey);
    expect(polls).toBe(1);
    expect(ingests).toBe(1);
    expect(record?.job).toMatchObject({status: 'ready', assetId: 'ga_' + 'c'.repeat(32), contentSha256: 'd'.repeat(64), qcStatus: 'qc_pending'});
    expect(record?.job).toHaveProperty('takeId');
  });

  it('persists provider failure and ingest failure without retrying a paid submission', async () => {
    const failed = await claim();
    const providerFailed: GenerationProviderClient = {
      createTask: async () => { throw new Error('not used'); },
      retrieveTask: async () => ({status: 'failed', providerJobId: 'provider-job-1', error: 'provider rejected'}),
    };
    await runGenerationWorkerTick({repository: failed.repo, provider: providerFailed, workerId: 'worker-a', now: new Date('2026-08-11T00:01:00Z'), ingestResult: async () => { throw new Error('not used'); }});
    expect((await failed.repo.get(failed.requestKey))?.job.status).toBe('failed');

    const ingestFailed = await claim();
    const providerSucceeded: GenerationProviderClient = {
      createTask: async () => { throw new Error('not used'); },
      retrieveTask: async () => ({status: 'succeeded', providerJobId: 'provider-job-1', resultTransportUrl: 'https://results.example.com/output.mp4'}),
    };
    await runGenerationWorkerTick({repository: ingestFailed.repo, provider: providerSucceeded, workerId: 'worker-a', now: new Date('2026-08-11T00:01:00Z'), ingestResult: async () => { throw new Error('decode failed'); }});
    const record = await ingestFailed.repo.get(ingestFailed.requestKey);
    expect(record?.job).toMatchObject({status: 'ingest_failed', lastErrorStage: 'ingest'});
    expect(record?.claim.status).toBe('submitted');
  });

  it('reconciles a stale submitting claim to uncertain without a provider call', async () => {
    const repository = createFilesystemGenerationRepository({rootDirectory: root()});
    const requestHash = 'f'.repeat(64);
    const requestKey = computeGenerationRequestKey('project-1', 'stale-attempt', requestHash);
    await repository.claimSubmission({projectId: 'project-1', attemptId: 'stale-attempt', requestKey, requestHash, provider: 'byteplus', model: 'dreamina-seedance-2-5-260628', authorizationRef: 'signed-auth'}, new Date('2026-08-11T00:00:00Z'));
    let providerCalls = 0;
    const provider: GenerationProviderClient = {
      createTask: async () => { providerCalls += 1; return {providerJobId: 'unexpected'}; },
      retrieveTask: async () => { providerCalls += 1; return {status: 'running', providerJobId: 'unexpected'}; },
    };
    await runGenerationWorkerTick({repository, provider, workerId: 'worker-stale', now: new Date('2026-08-11T01:00:00Z'), ingestResult: async () => { throw new Error('must not ingest'); }});
    expect(providerCalls).toBe(0);
    expect((await repository.get(requestKey))?.job.status).toBe('uncertain');
  });

  it('resumes a stale ingesting record after lease expiry without polling the provider again', async () => {
    const {repo, requestKey} = await claim();
    const lease = await repo.acquireLease(requestKey, 'crashed-worker', new Date('2026-08-11T00:00:02Z'), 1000);
    if (!lease) throw new Error('lease required');
    await repo.updateWithFence(requestKey, lease.fencingToken, (record) => ({
      ...record,
      job: {...record.job, status: 'ingesting', providerJobId: 'provider-job-1', resultTransportCiphertext: sealTransportUrl('https://results.example.com/output.mp4')},
    }));
    let ingests = 0;
    await runGenerationWorkerTick({
      repository: repo,
      provider: {createTask: async () => { throw new Error('not used'); }, retrieveTask: async () => { throw new Error('provider must not be polled'); }},
      workerId: 'recovery-worker',
      now: new Date('2026-08-11T00:00:04Z'),
      ingestResult: async () => { ingests += 1; return {assetId: `ga_${'e'.repeat(32)}`, contentSha256: 'f'.repeat(64), actualDurationSeconds: 30}; },
    });
    expect(ingests).toBe(1);
    expect((await repo.get(requestKey))?.job.status).toBe('ready');
  });
});
