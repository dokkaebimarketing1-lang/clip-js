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
import {
  generationRecordSchema,
  type GenerationLease,
  type GenerationProvider,
  type GenerationRecord,
} from './generation-schema';

const KEY_PATTERN = /^[a-f0-9]{64}$/;
const UPDATE_LOCK_STALE_MS = 30_000;
const BUSY = Symbol('generation-repository-busy');

export class GenerationRepositoryBusyError extends Error {
  constructor() {
    super('Generation repository record is busy.');
    this.name = 'GenerationRepositoryBusyError';
  }
}

export class GenerationFenceError extends Error {
  constructor() {
    super('Generation worker fencing token is stale.');
    this.name = 'GenerationFenceError';
  }
}

export type SubmissionClaimInput = {
  projectId: string;
  attemptId: string;
  requestKey: string;
  requestHash: string;
  provider: GenerationProvider;
  model: string;
  authorizedDuration?: 20 | 30;
  authorizedResolution?: '480p' | '720p';
  authorizedGenerateAudio?: boolean;
  takeScope?: 'production' | 'shot';
  targetShotSpecId?: string;
  authorizationRef: string;
};

export const computeGenerationRequestKey = (projectId: string, attemptId: string, requestHash: string, provider: GenerationProvider = 'byteplus'): string => {
  if (!projectId || !attemptId || !KEY_PATTERN.test(requestHash)) throw new Error('Invalid generation request identity.');
  return createHash('sha256').update(stableStringify({projectId, attemptId, requestHash, provider})).digest('hex');
};

const isCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === code;

const assertKey = (key: string): void => {
  if (!KEY_PATTERN.test(key)) throw new Error('Invalid generation request key.');
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

export const createFilesystemGenerationRepository = (options: {rootDirectory: string}) => {
  const root = options.rootDirectory;
  const recordsDirectory = join(root, 'records');
  const attemptsDirectory = join(root, 'attempts');
  const locksDirectory = join(root, 'update-locks');
  mkdirSync(recordsDirectory, {recursive: true});
  mkdirSync(attemptsDirectory, {recursive: true});
  mkdirSync(locksDirectory, {recursive: true});

  const recordPath = (key: string): string => {
    assertKey(key);
    return join(recordsDirectory, `${key}.json`);
  };
  const scopeKey = (projectId: string, provider: GenerationProvider): string =>
    createHash('sha256').update(stableStringify({scope: 'provider-billing', projectId, provider})).digest('hex');
  const attemptKey = (projectId: string, provider: GenerationProvider, attemptId: string): string =>
    createHash('sha256').update(stableStringify({scope: 'attempt', projectId, provider, attemptId})).digest('hex');
  const attemptPath = (key: string): string => {
    assertKey(key);
    return join(attemptsDirectory, `${key}.json`);
  };
  const readAttempt = (key: string): {requestKey: string; requestHash: string} | undefined => {
    const path = attemptPath(key);
    if (!existsSync(path)) return undefined;
    const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    if (!KEY_PATTERN.test(String(value.requestKey)) || !KEY_PATTERN.test(String(value.requestHash))) {
      throw new Error('Generation attempt index is corrupt; automatic submission is blocked.');
    }
    return {requestKey: String(value.requestKey), requestHash: String(value.requestHash)};
  };
  const lockPath = (key: string): string => {
    assertKey(key);
    return join(locksDirectory, key);
  };
  const read = (key: string): GenerationRecord | undefined => {
    const path = recordPath(key);
    if (!existsSync(path)) return undefined;
    try {
      return generationRecordSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    } catch {
      throw new Error(`Generation record ${key} is corrupt; automatic recovery is blocked.`);
    }
  };
  const acquireUpdateLock = (key: string): boolean => {
    const path = lockPath(key);
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
  const withUpdateLock = <T>(key: string, operation: () => T): T | typeof BUSY => {
    if (!acquireUpdateLock(key)) return BUSY;
    try {
      return operation();
    } finally {
      rmSync(lockPath(key), {recursive: true, force: true});
    }
  };
  const persistUpdated = (previous: GenerationRecord, candidate: GenerationRecord, now = new Date()): GenerationRecord => {
    if (candidate.requestKey !== previous.requestKey
      || candidate.claim.projectId !== previous.claim.projectId
      || candidate.claim.attemptId !== previous.claim.attemptId
      || candidate.claim.requestHash !== previous.claim.requestHash) {
      throw new Error('Generation record identity is immutable.');
    }
    const parsed = generationRecordSchema.parse({
      ...candidate,
      version: 1,
      revision: previous.revision + 1,
      claim: {...candidate.claim, updatedAt: now.toISOString()},
      job: {...candidate.job, updatedAt: now.toISOString()},
    });
    replaceJson(recordPath(previous.requestKey), parsed);
    return parsed;
  };

  return {
    get: async (key: string): Promise<GenerationRecord | undefined> => read(key),

    listAll: async (): Promise<GenerationRecord[]> => readdirSync(recordsDirectory, {withFileTypes: true})
      .filter((entry) => entry.isFile() && KEY_PATTERN.test(entry.name.replace(/\.json$/, '')))
      .map((entry) => read(entry.name.slice(0, -5)))
      .filter((record): record is GenerationRecord => Boolean(record))
      .sort((a, b) => a.claim.createdAt.localeCompare(b.claim.createdAt)),

    listProject: async (projectId: string): Promise<GenerationRecord[]> => readdirSync(recordsDirectory, {withFileTypes: true})
      .filter((entry) => entry.isFile() && KEY_PATTERN.test(entry.name.replace(/\.json$/, '')))
      .map((entry) => read(entry.name.slice(0, -5)))
      .filter((record): record is GenerationRecord => Boolean(record))
      .filter((record) => record.claim.projectId === projectId)
      .sort((a, b) => a.claim.createdAt.localeCompare(b.claim.createdAt)),

    claimSubmission: async (input: SubmissionClaimInput, now = new Date()): Promise<{record: GenerationRecord; created: boolean}> => {
      assertKey(input.requestKey);
      const expectedKey = computeGenerationRequestKey(input.projectId, input.attemptId, input.requestHash, input.provider);
      if (expectedKey !== input.requestKey) throw new Error('Generation request key does not match project, attempt, and request hash.');
      const result = withUpdateLock(scopeKey(input.projectId, input.provider), () => {
        const blocking = readdirSync(recordsDirectory, {withFileTypes: true})
          .filter((entry) => entry.isFile() && KEY_PATTERN.test(entry.name.replace(/\.json$/, '')))
          .map((entry) => read(entry.name.slice(0, -5)))
          .filter((record): record is GenerationRecord => Boolean(record))
          .find((record) => record.claim.projectId === input.projectId
            && record.job.provider === input.provider
            && ['submitting', 'uncertain'].includes(record.job.status)
            && record.requestKey !== input.requestKey);
        if (blocking) throw new Error(`Provider billing scope is locked by unresolved request ${blocking.requestKey}.`);

        const indexKey = attemptKey(input.projectId, input.provider, input.attemptId);
        const existingAttempt = readAttempt(indexKey);
        if (existingAttempt && (existingAttempt.requestKey !== input.requestKey || existingAttempt.requestHash !== input.requestHash)) {
          throw new Error('Generation attempt ID is already bound to a different request.');
        }
        if (!existingAttempt) {
          const created = writeExclusiveJson(attemptPath(indexKey), {
            version: 1,
            projectId: input.projectId,
            provider: input.provider,
            attemptId: input.attemptId,
            requestKey: input.requestKey,
            requestHash: input.requestHash,
            createdAt: now.toISOString(),
          });
          if (!created) {
            const racedAttempt = readAttempt(indexKey);
            if (!racedAttempt || racedAttempt.requestKey !== input.requestKey || racedAttempt.requestHash !== input.requestHash) {
              throw new Error('Generation attempt ID was claimed concurrently by a different request.');
            }
          }
        }

        const timestamp = now.toISOString();
        const record = generationRecordSchema.parse({
          version: 1,
          revision: 0,
          requestKey: input.requestKey,
          claim: {
            version: 1,
            status: 'claimed',
            projectId: input.projectId,
            attemptId: input.attemptId,
            requestKey: input.requestKey,
            requestHash: input.requestHash,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          job: {
            version: 1,
            status: 'submitting',
            ...input,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        });
        if (writeExclusiveJson(recordPath(input.requestKey), record)) return {record, created: true};
        const existing = read(input.requestKey);
        if (!existing) throw new Error('Generation claim exists but cannot be read.');
        if (existing.claim.projectId !== input.projectId
          || existing.claim.attemptId !== input.attemptId
          || existing.claim.requestHash !== input.requestHash) {
          throw new Error('Generation request key collision detected.');
        }
        return {record: existing, created: false};
      });
      if (result === BUSY) throw new GenerationRepositoryBusyError();
      return result;
    },

    recordProviderReceipt: async (key: string, providerJobId: string, now = new Date()): Promise<GenerationRecord> => {
      if (!providerJobId) throw new Error('Provider job id is required.');
      const result = withUpdateLock(key, () => {
        const previous = read(key);
        if (!previous) throw new Error('Generation claim not found.');
        const existingProviderJobId = 'providerJobId' in previous.job ? previous.job.providerJobId : previous.claim.providerJobId;
        if (existingProviderJobId && existingProviderJobId !== providerJobId) throw new Error('Generation request already has a different provider job receipt.');
        if (previous.claim.status === 'submitted' && existingProviderJobId === providerJobId) return previous;
        if (previous.claim.status === 'uncertain') throw new Error('Uncertain generation requires explicit recovery; receipt cannot be attached through submit flow.');
        return persistUpdated(previous, {
          ...previous,
          claim: {...previous.claim, status: 'submitted', providerJobId},
          job: {...previous.job, status: 'queued', providerJobId},
        } as GenerationRecord, now);
      });
      if (result === BUSY) throw new GenerationRepositoryBusyError();
      return result;
    },

    markUncertain: async (key: string, reason: string, providerJobIdOrNow?: string | Date, maybeNow?: Date): Promise<GenerationRecord> => {
      const explicitProviderJobId = typeof providerJobIdOrNow === 'string' ? providerJobIdOrNow : undefined;
      const now = providerJobIdOrNow instanceof Date ? providerJobIdOrNow : maybeNow ?? new Date();
      const result = withUpdateLock(key, () => {
        const previous = read(key);
        if (!previous) throw new Error('Generation claim not found.');
        if (['ready', 'failed', 'cancelled', 'expired'].includes(previous.job.status)) throw new Error('Terminal generation record cannot become uncertain.');
        const providerJobId = explicitProviderJobId ?? ('providerJobId' in previous.job ? previous.job.providerJobId : undefined);
        const uncertainJob = {
          ...previous.job,
          status: 'uncertain' as const,
          lastError: reason,
          lastErrorStage: previous.job.status === 'submitting' ? 'receipt' as const : previous.job.lastErrorStage ?? 'poll' as const,
          ...(providerJobId ? {providerJobId} : {}),
        };
        return persistUpdated(previous, {
          ...previous,
          claim: {...previous.claim, status: 'uncertain', ...(providerJobId ? {providerJobId} : {})},
          job: uncertainJob,
        } as GenerationRecord, now);
      });
      if (result === BUSY) throw new GenerationRepositoryBusyError();
      return result;
    },

    acquireLease: async (key: string, workerId: string, now = new Date(), ttlMs = 30_000): Promise<GenerationLease | undefined> => {
      if (!workerId || ttlMs < 1) throw new Error('Valid worker id and lease duration are required.');
      const result = withUpdateLock(key, () => {
        const previous = read(key);
        if (!previous) throw new Error('Generation record not found.');
        const current = previous.job.lease;
        if (current && new Date(current.expiresAt).getTime() > now.getTime() && current.workerId !== workerId) return undefined;
        if (current && new Date(current.expiresAt).getTime() > now.getTime() && current.workerId === workerId) return current;
        const lease: GenerationLease = {
          workerId,
          fencingToken: (current?.fencingToken ?? 0) + 1,
          acquiredAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
        };
        persistUpdated(previous, {...previous, job: {...previous.job, lease}} as GenerationRecord, now);
        return lease;
      });
      return result === BUSY ? undefined : result;
    },

    updateWithFence: async (
      key: string,
      fencingToken: number,
      mutate: (record: GenerationRecord) => GenerationRecord,
      now = new Date(),
    ): Promise<GenerationRecord> => {
      const result = withUpdateLock(key, () => {
        const previous = read(key);
        if (!previous) throw new Error('Generation record not found.');
        if (!previous.job.lease || previous.job.lease.fencingToken !== fencingToken) throw new GenerationFenceError();
        return persistUpdated(previous, mutate(structuredClone(previous)), now);
      });
      if (result === BUSY) throw new GenerationRepositoryBusyError();
      return result;
    },
  };
};

export type FilesystemGenerationRepository = ReturnType<typeof createFilesystemGenerationRepository>;
