import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {createFilesystemRenderJobRepository} from './render-job-repository.server';
import {runRenderWorkerTick} from './render-worker.server';

const directories: string[] = [];
const repository = () => {
  const directory = mkdtempSync(join(tmpdir(), 'clipjs-render-job-'));
  directories.push(directory);
  return createFilesystemRenderJobRepository({rootDirectory: directory});
};
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, {recursive: true, force: true})));
const snapshot = {projectSchemaVersion: 3, revision: 0, id: 'project-1', projectName: 'render'};
const create = (repo: ReturnType<typeof repository>, hash: string) => repo.create({
  projectId: 'project-1', renderInputHash: hash.repeat(64), releaseSignature: 'a'.repeat(64), projectSnapshot: snapshot,
}, new Date('2026-08-11T00:00:00Z'));

describe('durable render jobs', () => {
  it('renders once under worker competition', async () => {
    const repo = repository();
    const first = await create(repo, 'a');
    const second = await create(repo, 'a');
    expect(second.created).toBe(false);
    let renders = 0;
    const render = async () => { renders += 1; return {renderId: '11111111-1111-4111-8111-111111111111'}; };
    await Promise.all([
      runRenderWorkerTick({repository: repo, workerId: 'worker-a', render, now: new Date('2026-08-11T00:00:02Z')}),
      runRenderWorkerTick({repository: repo, workerId: 'worker-b', render, now: new Date('2026-08-11T00:00:02Z')}),
    ]);
    expect(renders).toBe(1);
    expect(await repo.get(first.record.id)).toMatchObject({status: 'succeeded', outputRenderId: '11111111-1111-4111-8111-111111111111'});
    const expiredArtifactRetry = await repo.requeueTerminal(first.record.id, {releaseSignature: 'c'.repeat(64), projectSnapshot: snapshot});
    expect(expiredArtifactRetry).toMatchObject({status: 'queued', attemptCount: 1});
  });

  it('requires explicit requeue after failure', async () => {
    const repo = repository();
    const created = await create(repo, 'f');
    await runRenderWorkerTick({repository: repo, workerId: 'worker-fail', render: async () => { throw new Error('simulated'); }});
    expect((await repo.get(created.record.id))?.status).toBe('failed');
    const requeued = await repo.requeueTerminal(created.record.id, {releaseSignature: 'b'.repeat(64), projectSnapshot: snapshot});
    expect(requeued).toMatchObject({status: 'queued', attemptCount: 1});
    expect(requeued.error).toBeUndefined();
  });

  it('cancels active work on shutdown and preserves fencing takeover', async () => {
    const repo = repository();
    const created = await create(repo, '9');
    const controller = new AbortController();
    const render = async (_snapshot: unknown, signal?: AbortSignal): Promise<{renderId: string}> => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('aborted')), {once: true});
      queueMicrotask(() => controller.abort());
    });
    await runRenderWorkerTick({repository: repo, workerId: 'worker-abort', render, signal: controller.signal});
    expect((await repo.get(created.record.id))?.status).toBe('queued');
    const base = new Date(Date.now() + 1000);
    const first = await repo.acquireLease(created.record.id, 'crashed', base, 1000);
    const second = await repo.acquireLease(created.record.id, 'recovery', new Date(base.getTime() + 2000), 1000);
    expect(second?.fencingToken).toBe((first?.fencingToken ?? 0) + 1);
  });
});
