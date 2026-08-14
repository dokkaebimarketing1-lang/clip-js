import {createHash, randomUUID} from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {dirname, join} from 'node:path';
import {stableStringify} from '@/app/lib/workflow/hash';
import {storyboardSchema, type Storyboard} from '@/app/lib/workflow/schema';
import {
  storyboardJobInputSchema,
  storyboardJobRecordSchema,
  type StoryboardJobInput,
  type StoryboardJobRecord,
} from './storyboard-job-schema';

const JOB_ID_PATTERN = /^sj_[a-f0-9]{64}$/;
const UPDATE_LOCK_STALE_MS = 30_000;
const BUSY = Symbol('storyboard-job-repository-busy');

export class StoryboardJobRepositoryBusyError extends Error {
  constructor() {
    super('Storyboard job record is busy.');
    this.name = 'StoryboardJobRepositoryBusyError';
  }
}

export class StoryboardJobFenceError extends Error {
  constructor() {
    super('Storyboard worker fencing token is stale.');
    this.name = 'StoryboardJobFenceError';
  }
}

const isCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === code;

const assertJobId = (jobId: string): void => {
  if (!JOB_ID_PATTERN.test(jobId)) throw new Error('Invalid storyboard job ID.');
};

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

const writeExclusiveJson = (path: string, value: unknown): boolean => {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value)}\n`, {encoding: 'utf8'});
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    fsyncDirectory(dirname(path));
    return true;
  } catch (error) {
    if (isCode(error, 'EEXIST')) return false;
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
};

const replaceJson = (path: string, value: unknown): void => {
  const temporary = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value)}\n`, {encoding: 'utf8'});
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
    fsyncDirectory(dirname(path));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) rmSync(temporary, {force: true});
  }
};

export const computeStoryboardRequestHash = (rawInput: StoryboardJobInput): string => {
  const input = storyboardJobInputSchema.parse(rawInput);
  return createHash('sha256').update(stableStringify(input)).digest('hex');
};

export const createFilesystemStoryboardJobRepository = (options: {rootDirectory: string}) => {
  const recordsDirectory = join(options.rootDirectory, 'records');
  const locksDirectory = join(options.rootDirectory, 'update-locks');
  mkdirSync(recordsDirectory, {recursive: true});
  mkdirSync(locksDirectory, {recursive: true});

  const recordPath = (jobId: string): string => {
    assertJobId(jobId);
    return join(recordsDirectory, `${jobId}.json`);
  };
  const lockPath = (jobId: string): string => {
    assertJobId(jobId);
    return join(locksDirectory, jobId);
  };
  const read = (jobId: string): StoryboardJobRecord | undefined => {
    const path = recordPath(jobId);
    if (!existsSync(path)) return undefined;
    try {
      return storyboardJobRecordSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    } catch {
      throw new Error(`Storyboard job ${jobId} is corrupt; automatic recovery is blocked.`);
    }
  };
  const acquireLock = (jobId: string): boolean => {
    const path = lockPath(jobId);
    try {
      mkdirSync(path);
      return true;
    } catch (error) {
      if (!isCode(error, 'EEXIST')) throw error;
      try {
        if (Date.now() - statSync(path).mtimeMs <= UPDATE_LOCK_STALE_MS) return false;
        rmSync(path, {recursive: true, force: true});
        mkdirSync(path);
        return true;
      } catch (retryError) {
        if (isCode(retryError, 'EEXIST') || isCode(retryError, 'ENOENT')) return false;
        throw retryError;
      }
    }
  };
  const withLock = <T>(jobId: string, operation: () => T): T | typeof BUSY => {
    if (!acquireLock(jobId)) return BUSY;
    try {
      return operation();
    } finally {
      rmSync(lockPath(jobId), {recursive: true, force: true});
    }
  };
  const persist = (previous: StoryboardJobRecord, candidate: StoryboardJobRecord, now = new Date()): StoryboardJobRecord => {
    if (candidate.jobId !== previous.jobId || candidate.projectId !== previous.projectId || candidate.requestHash !== previous.requestHash) {
      throw new Error('Storyboard job identity is immutable.');
    }
    const parsed = storyboardJobRecordSchema.parse({
      ...candidate,
      version: 1,
      revision: previous.revision + 1,
      updatedAt: now.toISOString(),
    });
    replaceJson(recordPath(previous.jobId), parsed);
    return parsed;
  };

  return {
    get: async (jobId: string): Promise<StoryboardJobRecord | undefined> => read(jobId),

    latestForProject: async (projectId: string): Promise<StoryboardJobRecord | undefined> => readdirSync(recordsDirectory, {withFileTypes: true})
      .filter((entry) => entry.isFile() && JOB_ID_PATTERN.test(entry.name.replace(/\.json$/, '')))
      .map((entry) => read(entry.name.slice(0, -5)))
      .filter((record): record is StoryboardJobRecord => Boolean(record))
      .filter((record) => record.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0],

    createOrGet: async (rawInput: StoryboardJobInput, now = new Date()): Promise<{record: StoryboardJobRecord; created: boolean}> => {
      const input = storyboardJobInputSchema.parse(rawInput);
      const requestHash = computeStoryboardRequestHash(input);
      const jobId = `sj_${requestHash}`;
      const result = withLock(jobId, () => {
        const existing = read(jobId);
        if (existing) return {record: existing, created: false};
        const timestamp = now.toISOString();
        const record = storyboardJobRecordSchema.parse({
          version: 1,
          revision: 0,
          jobId,
          projectId: input.projectId,
          requestHash,
          status: 'queued',
          input,
          attempt: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        if (!writeExclusiveJson(recordPath(jobId), record)) {
          const raced = read(jobId);
          if (!raced) throw new Error('Storyboard job was created concurrently but cannot be read.');
          return {record: raced, created: false};
        }
        return {record, created: true};
      });
      if (result === BUSY) throw new StoryboardJobRepositoryBusyError();
      return result;
    },

    requeueFailed: async (jobId: string, now = new Date()): Promise<StoryboardJobRecord> => {
      const result = withLock(jobId, () => {
        const current = read(jobId);
        if (!current) throw new Error('Storyboard job not found.');
        if (current.status !== 'failed') return current;
        return persist(current, storyboardJobRecordSchema.parse({
          ...current,
          status: 'queued',
          lease: undefined,
          storyboard: undefined,
          error: undefined,
        }), now);
      });
      if (result === BUSY) throw new StoryboardJobRepositoryBusyError();
      return result;
    },

    claim: async (jobId: string, workerId: string, now = new Date(), leaseMs = 5 * 60_000): Promise<StoryboardJobRecord | undefined> => {
      if (!workerId || leaseMs <= 0) throw new Error('Invalid storyboard worker lease.');
      const result = withLock(jobId, () => {
        const current = read(jobId);
        if (!current) return undefined;
        if (current.status === 'completed' || current.status === 'failed') return undefined;
        if (current.status === 'processing' && current.lease && Date.parse(current.lease.expiresAt) > now.getTime()) return undefined;
        return persist(current, storyboardJobRecordSchema.parse({
          ...current,
          status: 'processing',
          attempt: current.attempt + 1,
          lease: {
            token: randomUUID(),
            workerId,
            claimedAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
          },
          error: undefined,
        }), now);
      });
      if (result === BUSY) return undefined;
      return result;
    },

    complete: async (jobId: string, token: string, rawStoryboard: Storyboard, now = new Date()): Promise<StoryboardJobRecord> => {
      const storyboard = storyboardSchema.parse(rawStoryboard);
      const result = withLock(jobId, () => {
        const current = read(jobId);
        if (!current) throw new Error('Storyboard job not found.');
        if (current.status !== 'processing' || current.lease?.token !== token) throw new StoryboardJobFenceError();
        return persist(current, storyboardJobRecordSchema.parse({
          ...current,
          status: 'completed',
          lease: undefined,
          storyboard,
          error: undefined,
        }), now);
      });
      if (result === BUSY) throw new StoryboardJobRepositoryBusyError();
      return result;
    },

    fail: async (jobId: string, token: string, message: string, now = new Date()): Promise<StoryboardJobRecord> => {
      const safeMessage = message.trim().slice(0, 1000) || 'Storyboard generation failed.';
      const result = withLock(jobId, () => {
        const current = read(jobId);
        if (!current) throw new Error('Storyboard job not found.');
        if (current.status !== 'processing' || current.lease?.token !== token) throw new StoryboardJobFenceError();
        return persist(current, storyboardJobRecordSchema.parse({
          ...current,
          status: 'failed',
          lease: undefined,
          storyboard: undefined,
          error: safeMessage,
        }), now);
      });
      if (result === BUSY) throw new StoryboardJobRepositoryBusyError();
      return result;
    },
  };
};

export type StoryboardJobRepository = ReturnType<typeof createFilesystemStoryboardJobRepository>;
