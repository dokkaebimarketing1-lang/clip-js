import {createHash, randomUUID} from 'node:crypto';
import {closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {stableStringify} from '@/app/lib/workflow/hash';
import {renderJobSchema, type RenderJob, type RenderLease} from './render-job-schema';

const BUSY = Symbol('busy');
const STALE_LOCK_MS = 30_000;
const isCode = (error: unknown, code: string): boolean => typeof error === 'object' && error !== null && 'code' in error && error.code === code;
const jobId = (projectId: string, renderInputHash: string) => `rj_${createHash('sha256').update(stableStringify({projectId, renderInputHash})).digest('hex').slice(0, 32)}`;

const fsyncDirectory = (path: string): void => {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, 'r');
    fsyncSync(descriptor);
  } catch (error) {
    if (process.platform !== 'win32' || !isCode(error, 'EPERM')) throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
};

export class RenderFenceError extends Error {
  constructor() { super('Render worker fencing token is stale.'); this.name = 'RenderFenceError'; }
}

const writeExclusive = (path: string, value: unknown): boolean => {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'wx', 0o600);
    writeFileSync(fd, `${JSON.stringify(value)}\n`, {encoding: 'utf8'});
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    fsyncDirectory(dirname(path));
    return true;
  } catch (error) {
    if (isCode(error, 'EEXIST')) return false;
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
};

const replace = (path: string, value: unknown): void => {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(temp, 'wx', 0o600);
    writeFileSync(fd, `${JSON.stringify(value)}\n`, {encoding: 'utf8'});
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temp, path);
    fsyncDirectory(dirname(path));
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temp, {force: true});
  }
};

export type CreateRenderJobInput = {
  projectId: string;
  renderInputHash: string;
  releaseSignature: string;
  projectSnapshot: unknown;
};

export const createFilesystemRenderJobRepository = (options: {rootDirectory: string}) => {
  const jobsDirectory = join(options.rootDirectory, 'jobs');
  const locksDirectory = join(options.rootDirectory, 'locks');
  mkdirSync(jobsDirectory, {recursive: true});
  mkdirSync(locksDirectory, {recursive: true});
  const pathFor = (id: string) => join(jobsDirectory, `${id}.json`);
  const read = (id: string): RenderJob | undefined => {
    const path = pathFor(id);
    if (!existsSync(path)) return undefined;
    return renderJobSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  };
  const acquireLock = (id: string): boolean => {
    const lock = join(locksDirectory, `${id}.lock`);
    try {
      mkdirSync(lock);
      return true;
    } catch (error) {
      if (!isCode(error, 'EEXIST')) throw error;
      try {
        if (Date.now() - statSync(lock).mtimeMs <= STALE_LOCK_MS) return false;
        rmSync(lock, {recursive: true, force: true});
        mkdirSync(lock);
        return true;
      } catch (retryError) {
        if (isCode(retryError, 'EEXIST') || isCode(retryError, 'ENOENT')) return false;
        throw retryError;
      }
    }
  };
  const withLock = <T>(id: string, action: () => T): T | typeof BUSY => {
    if (!acquireLock(id)) return BUSY;
    const lock = join(locksDirectory, `${id}.lock`);
    try {
      return action();
    } finally {
      rmSync(lock, {recursive: true, force: true});
    }
  };
  const persist = (previous: RenderJob, candidate: RenderJob, now: Date): RenderJob => {
    if (candidate.id !== previous.id || candidate.projectId !== previous.projectId || candidate.renderInputHash !== previous.renderInputHash) throw new Error('Render job identity is immutable.');
    const parsed = renderJobSchema.parse({...candidate, updatedAt: now.toISOString()});
    replace(pathFor(previous.id), parsed);
    return parsed;
  };

  return {
    create: async (input: CreateRenderJobInput, now = new Date()): Promise<{record: RenderJob; created: boolean}> => {
      const id = jobId(input.projectId, input.renderInputHash);
      const record = renderJobSchema.parse({version: 1, id, status: 'queued', ...input, createdAt: now.toISOString(), updatedAt: now.toISOString(), nextAttemptAt: now.toISOString()});
      if (writeExclusive(pathFor(id), record)) return {record, created: true};
      const existing = read(id);
      if (!existing || existing.projectId !== input.projectId || existing.renderInputHash !== input.renderInputHash) throw new Error('Render job identity collision.');
      return {record: existing, created: false};
    },
    get: async (id: string): Promise<RenderJob | undefined> => read(id),
    requeueTerminal: async (id: string, input: {releaseSignature: string; projectSnapshot: unknown}, now = new Date()): Promise<RenderJob> => {
      const result = withLock(id, () => {
        const previous = read(id);
        if (!previous) throw new Error('Render job does not exist.');
        if (previous.status !== 'failed' && previous.status !== 'succeeded') return previous;
        if (previous.attemptCount >= 3) throw new Error('Render retry limit reached.');
        return persist(previous, {
          ...previous,
          status: 'queued',
          releaseSignature: input.releaseSignature,
          projectSnapshot: input.projectSnapshot,
          attemptCount: previous.attemptCount + 1,
          nextAttemptAt: now.toISOString(),
          lease: previous.lease ? {...previous.lease, expiresAt: now.toISOString()} : undefined,
          error: undefined,
        } as RenderJob, now);
      });
      if (result === BUSY) throw new Error('Render job record is busy.');
      return result;
    },
    listAll: async (): Promise<RenderJob[]> => readdirSync(jobsDirectory, {withFileTypes: true})
      .filter((entry) => entry.isFile() && /^rj_[a-f0-9]{32}\.json$/.test(entry.name))
      .map((entry) => read(entry.name.slice(0, -5)))
      .filter((job): job is RenderJob => Boolean(job))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    acquireLease: async (id: string, workerId: string, now = new Date(), ttlMs = 600_000): Promise<RenderLease | undefined> => {
      const result = withLock(id, () => {
        const previous = read(id);
        if (!previous) throw new Error('Render job not found.');
        const current = previous.lease;
        if (current && new Date(current.expiresAt).getTime() > now.getTime() && current.workerId !== workerId) return undefined;
        if (current && new Date(current.expiresAt).getTime() > now.getTime()) return current;
        const lease = {workerId, fencingToken: (current?.fencingToken ?? 0) + 1, acquiredAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttlMs).toISOString()};
        persist(previous, {...previous, lease} as RenderJob, now);
        return lease;
      });
      return result === BUSY ? undefined : result;
    },
    updateWithFence: async (id: string, fencingToken: number, mutate: (record: RenderJob) => RenderJob, now = new Date()): Promise<RenderJob> => {
      const result = withLock(id, () => {
        const previous = read(id);
        if (!previous) throw new Error('Render job not found.');
        if (!previous.lease || previous.lease.fencingToken !== fencingToken) throw new RenderFenceError();
        return persist(previous, mutate(structuredClone(previous)), now);
      });
      if (result === BUSY) throw new Error('Render job record is busy.');
      return result;
    },
  };
};

export type FilesystemRenderJobRepository = ReturnType<typeof createFilesystemRenderJobRepository>;
