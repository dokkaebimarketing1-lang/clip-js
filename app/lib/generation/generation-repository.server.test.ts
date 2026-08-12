import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
  computeGenerationRequestKey,
  createFilesystemGenerationRepository,
  GenerationFenceError,
} from './generation-repository.server';

const directories: string[] = [];
const directory = () => {
  const path = mkdtempSync(join(tmpdir(), 'clipjs-generation-repo-'));
  directories.push(path);
  return path;
};
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, {recursive: true, force: true})));

const requestHash = 'a'.repeat(64);
const claim = (requestKey: string) => ({
  projectId: 'project-1', attemptId: 'attempt-1', requestKey, requestHash,
  provider: 'byteplus' as const, model: 'fake-seedance-2.5', authorizationRef: 'auth-1',
});

describe('filesystem generation repository', () => {
  it('binds request identity to project, attempt, request hash, and provider scope', () => {
    const first = computeGenerationRequestKey('project-1', 'attempt-1', requestHash);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(computeGenerationRequestKey('project-1', 'attempt-1', requestHash)).toBe(first);
    expect(computeGenerationRequestKey('project-1', 'attempt-2', requestHash)).not.toBe(first);
    expect(computeGenerationRequestKey('project-1', 'attempt-1', requestHash, 'fake')).not.toBe(first);
  });

  it('creates claim and submitting job atomically and never replaces an existing request', async () => {
    const root = directory();
    const first = createFilesystemGenerationRepository({rootDirectory: root});
    const second = createFilesystemGenerationRepository({rootDirectory: root});
    const key = computeGenerationRequestKey('project-1', 'attempt-1', requestHash);
    const [a, b] = await Promise.all([first.claimSubmission(claim(key)), second.claimSubmission(claim(key))]);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
    expect(a.record.job.status).toBe('submitting');
    expect(b.record.requestKey).toBe(key);
    expect((await first.listProject('project-1'))).toHaveLength(1);
  });

  it('binds attempt IDs forever and blocks new attempts while the provider scope is unresolved', async () => {
    const repo = createFilesystemGenerationRepository({rootDirectory: directory()});
    const firstKey = computeGenerationRequestKey('project-1', 'attempt-1', requestHash);
    await repo.claimSubmission(claim(firstKey));
    await repo.recordProviderReceipt(firstKey, 'provider-job-1');

    const differentHash = 'b'.repeat(64);
    const reboundKey = computeGenerationRequestKey('project-1', 'attempt-1', differentHash);
    await expect(repo.claimSubmission({...claim(reboundKey), requestKey: reboundKey, requestHash: differentHash}))
      .rejects.toThrow(/attempt ID/i);

    const uncertainKey = computeGenerationRequestKey('project-1', 'attempt-2', requestHash);
    await repo.claimSubmission({...claim(uncertainKey), attemptId: 'attempt-2'});
    await repo.markUncertain(uncertainKey, 'provider response lost');
    const thirdKey = computeGenerationRequestKey('project-1', 'attempt-3', requestHash);
    await expect(repo.claimSubmission({...claim(thirdKey), attemptId: 'attempt-3'}))
      .rejects.toThrow(/billing scope/i);
  });

  it('persists one provider receipt and keeps uncertain records non-replayable without a provider id', async () => {
    const repo = createFilesystemGenerationRepository({rootDirectory: directory()});
    const key = computeGenerationRequestKey('project-1', 'attempt-1', requestHash);
    await repo.claimSubmission(claim(key));
    const queued = await repo.recordProviderReceipt(key, 'provider-job-1');
    expect(queued.job).toMatchObject({status: 'queued', providerJobId: 'provider-job-1'});
    await expect(repo.recordProviderReceipt(key, 'provider-job-2')).rejects.toThrow(/different provider job/i);

    const uncertainKey = computeGenerationRequestKey('project-1', 'attempt-2', requestHash);
    await repo.claimSubmission({...claim(uncertainKey), attemptId: 'attempt-2'});
    const uncertain = await repo.markUncertain(uncertainKey, 'provider response lost');
    expect(uncertain.job).toMatchObject({status: 'uncertain'});
    expect(uncertain.job).not.toHaveProperty('providerJobId');
    const replay = await repo.claimSubmission({...claim(uncertainKey), attemptId: 'attempt-2'});
    expect(replay.created).toBe(false);
    expect(replay.record.job.status).toBe('uncertain');
  });

  it('allows one lease winner, increments fencing on takeover, and rejects stale worker writes', async () => {
    const root = directory();
    const first = createFilesystemGenerationRepository({rootDirectory: root});
    const second = createFilesystemGenerationRepository({rootDirectory: root});
    const key = computeGenerationRequestKey('project-1', 'attempt-1', requestHash);
    await first.claimSubmission(claim(key));
    await first.recordProviderReceipt(key, 'provider-job-1');
    const at = new Date('2026-01-01T00:00:00.000Z');
    const [leaseA, leaseB] = await Promise.all([
      first.acquireLease(key, 'worker-a', at, 1_000),
      second.acquireLease(key, 'worker-b', at, 1_000),
    ]);
    const winner = leaseA ?? leaseB;
    expect([leaseA, leaseB].filter(Boolean)).toHaveLength(1);
    expect(winner?.fencingToken).toBe(1);

    const takeover = await second.acquireLease(key, 'worker-b', new Date(at.getTime() + 1_001), 1_000);
    expect(takeover?.fencingToken).toBe(2);
    await expect(first.updateWithFence(key, 1, (record) => ({...record, job: {...record.job, status: 'running'} as never})))
      .rejects.toBeInstanceOf(GenerationFenceError);
    const running = await second.updateWithFence(key, 2, (record) => ({...record, job: {...record.job, status: 'running'} as never}));
    expect(running.job.status).toBe('running');
  });
});
