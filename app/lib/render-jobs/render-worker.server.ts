import type {FilesystemRenderJobRepository} from './render-job-repository.server';
import type {RenderJob} from './render-job-schema';

export type RenderExecutor = (projectSnapshot: unknown, signal?: AbortSignal) => Promise<{renderId: string}>;

export const runRenderWorkerTick = async (options: {
  repository: FilesystemRenderJobRepository;
  workerId: string;
  render: RenderExecutor;
  now?: Date;
  leaseMs?: number;
  signal?: AbortSignal;
}): Promise<void> => {
  const now = options.now ?? new Date();
  const jobs = await options.repository.listAll();
  for (const listed of jobs) {
    options.signal?.throwIfAborted();
    if (!['queued', 'running'].includes(listed.status)) continue;
    if (listed.nextAttemptAt && new Date(listed.nextAttemptAt).getTime() > now.getTime()) continue;
    const lease = await options.repository.acquireLease(listed.id, options.workerId, now, options.leaseMs ?? 600_000);
    if (!lease) continue;
    const current = await options.repository.get(listed.id);
    if (!current || !['queued', 'running'].includes(current.status)) continue;
    await options.repository.updateWithFence(listed.id, lease.fencingToken, (record) => ({
      ...record,
      status: 'running',
      lease,
      error: undefined,
    } as RenderJob), now);
    try {
      const output = await options.render(current.projectSnapshot, options.signal);
      await options.repository.updateWithFence(listed.id, lease.fencingToken, (record) => ({
        ...record,
        status: 'succeeded',
        outputRenderId: output.renderId,
        lease: {...lease, expiresAt: new Date().toISOString()},
        error: undefined,
      } as RenderJob), new Date());
    } catch (error) {
      if (options.signal?.aborted) {
        await options.repository.updateWithFence(listed.id, lease.fencingToken, (record) => ({
          ...record,
          status: 'queued',
          nextAttemptAt: new Date().toISOString(),
          lease: {...lease, expiresAt: new Date().toISOString()},
          error: undefined,
        } as RenderJob), new Date());
        return;
      }
      const message = error instanceof Error ? error.message : 'Render worker failed.';
      try {
        await options.repository.updateWithFence(listed.id, lease.fencingToken, (record) => ({
          ...record,
          status: 'failed',
          error: message,
          lease: {...lease, expiresAt: new Date().toISOString()},
        } as RenderJob), new Date());
      } catch (fenceError) {
        if (fenceError instanceof Error && /fencing/i.test(fenceError.message)) continue;
        throw fenceError;
      }
    }
  }
};
