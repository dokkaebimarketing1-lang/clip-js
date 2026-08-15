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
  writeFileSync,
} from 'node:fs';
import {dirname, join} from 'node:path';
import {z} from 'zod';
import {stableStringify} from '@/app/lib/workflow/hash';

const HEX64 = /^[a-f0-9]{64}$/;
const LOCK_WAIT_MS = 2_000;

const recordSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  requestKey: z.string().regex(HEX64),
  requestHash: z.string().regex(HEX64),
  projectId: z.string().min(1).max(256),
  characterId: z.string().min(1).max(128),
  attemptId: z.string().uuid(),
  styleBibleHash: z.string().regex(HEX64),
  styleReferenceImageIds: z.array(z.string().min(1).max(256)).max(16),
  status: z.enum(['submitting', 'queued', 'uncertain', 'completed', 'failed']),
  providerJobId: z.string().uuid().optional(),
  assetId: z.string().min(1).max(256).optional(),
  lastError: z.string().max(4_000).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export type CharacterImageSubmissionRecord = z.infer<typeof recordSchema>;
export type CharacterImageSubmissionClaim = Omit<CharacterImageSubmissionRecord,
  'version' | 'revision' | 'status' | 'providerJobId' | 'assetId' | 'lastError' | 'createdAt' | 'updatedAt'>;

export class CharacterImageSubmissionBusyError extends Error {
  constructor() {
    super('Character image submission repository is busy.');
    this.name = 'CharacterImageSubmissionBusyError';
  }
}

export class CharacterImageSubmissionConflictError extends Error {
  constructor(public readonly code: 'BILLING_SCOPE_LOCKED' | 'ATTEMPT_ID_REUSED', message: string) {
    super(message);
    this.name = 'CharacterImageSubmissionConflictError';
  }
}

export const computeCharacterImageRequestKey = (projectId: string, attemptId: string, requestHash: string): string => {
  if (!projectId || !z.string().uuid().safeParse(attemptId).success || !HEX64.test(requestHash)) {
    throw new Error('Invalid character image request identity.');
  }
  return createHash('sha256').update(stableStringify({scope: 'character-image-paid-submit', projectId, attemptId, requestHash})).digest('hex');
};

const isCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === code;

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

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const createFilesystemCharacterImageSubmissionRepository = (options: {rootDirectory: string; lockWaitMs?: number}) => {
  const lockWaitMs = options.lockWaitMs ?? LOCK_WAIT_MS;
  if (!Number.isFinite(lockWaitMs) || lockWaitMs < 0 || lockWaitMs > LOCK_WAIT_MS) throw new Error('Invalid character image lock wait.');
  const recordsDirectory = join(options.rootDirectory, 'records');
  const activeDirectory = join(options.rootDirectory, 'active');
  const locksDirectory = join(options.rootDirectory, 'locks');
  mkdirSync(recordsDirectory, {recursive: true});
  mkdirSync(activeDirectory, {recursive: true});
  mkdirSync(locksDirectory, {recursive: true});

  const assertKey = (key: string) => {
    if (!HEX64.test(key)) throw new Error('Invalid character image request key.');
  };
  const projectScopeKey = (projectId: string) => createHash('sha256').update(stableStringify({scope: 'character-image-project', projectId})).digest('hex');
  const recordPath = (key: string) => { assertKey(key); return join(recordsDirectory, `${key}.json`); };
  const activePath = (projectId: string) => join(activeDirectory, `${projectScopeKey(projectId)}.json`);
  const lockPath = (projectId: string) => join(locksDirectory, projectScopeKey(projectId));
  const readRecord = (key: string): CharacterImageSubmissionRecord | undefined => {
    const path = recordPath(key);
    if (!existsSync(path)) return undefined;
    try {
      return recordSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    } catch {
      throw new Error(`Character image submission ${key} is corrupt; paid submission is blocked.`);
    }
  };
  const readActiveKey = (projectId: string): string | undefined => {
    const path = activePath(projectId);
    if (!existsSync(path)) return undefined;
    const value = JSON.parse(readFileSync(path, 'utf8')) as {requestKey?: unknown};
    if (typeof value.requestKey !== 'string' || !HEX64.test(value.requestKey)) {
      throw new Error('Character image active submission index is corrupt; paid submission is blocked.');
    }
    return value.requestKey;
  };
  const acquireProjectLock = async (projectId: string): Promise<void> => {
    const path = lockPath(projectId);
    const deadline = Date.now() + lockWaitMs;
    while (true) {
      try {
        mkdirSync(path);
        return;
      } catch (error) {
        if (!isCode(error, 'EEXIST')) throw error;
        if (Date.now() >= deadline) throw new CharacterImageSubmissionBusyError();
        await delay(10);
      }
    }
  };
  const withProjectLock = async <T>(projectId: string, operation: () => T): Promise<T> => {
    await acquireProjectLock(projectId);
    try {
      return operation();
    } finally {
      rmSync(lockPath(projectId), {recursive: true, force: true});
    }
  };
  const persist = (previous: CharacterImageSubmissionRecord, changes: Partial<CharacterImageSubmissionRecord>): CharacterImageSubmissionRecord => {
    const next = recordSchema.parse({
      ...previous,
      ...changes,
      version: 1,
      revision: previous.revision + 1,
      requestKey: previous.requestKey,
      requestHash: previous.requestHash,
      projectId: previous.projectId,
      characterId: previous.characterId,
      attemptId: previous.attemptId,
      updatedAt: new Date().toISOString(),
    });
    replaceJson(recordPath(previous.requestKey), next);
    return next;
  };

  return {
    get: async (key: string) => readRecord(key),

    claim: async (input: CharacterImageSubmissionClaim): Promise<{record: CharacterImageSubmissionRecord; created: boolean}> => {
      const expectedKey = computeCharacterImageRequestKey(input.projectId, input.attemptId, input.requestHash);
      if (expectedKey !== input.requestKey) throw new Error('Character image request key does not match its identity.');
      return withProjectLock(input.projectId, () => {
        const activeKey = readActiveKey(input.projectId);
        const active = activeKey ? readRecord(activeKey) : undefined;
        if (active && ['submitting', 'queued', 'uncertain'].includes(active.status)) {
          if (active.requestKey === input.requestKey
            || (active.requestHash === input.requestHash && active.characterId === input.characterId)) {
            return {record: active, created: false};
          }
          throw new CharacterImageSubmissionConflictError('BILLING_SCOPE_LOCKED', `Character image provider billing scope is locked by unresolved request ${active.requestKey}.`);
        }
        const existing = readRecord(input.requestKey);
        if (existing) {
          if (existing.projectId !== input.projectId || existing.attemptId !== input.attemptId || existing.requestHash !== input.requestHash) {
            throw new CharacterImageSubmissionConflictError('ATTEMPT_ID_REUSED', 'Character image request identity collision detected.');
          }
          return {record: existing, created: false};
        }
        const timestamp = new Date().toISOString();
        const record = recordSchema.parse({...input, version: 1, revision: 0, status: 'submitting', createdAt: timestamp, updatedAt: timestamp});
        if (!writeExclusiveJson(recordPath(input.requestKey), record)) {
          const raced = readRecord(input.requestKey);
          if (!raced) throw new Error('Character image claim exists but cannot be read.');
          return {record: raced, created: false};
        }
        replaceJson(activePath(input.projectId), {version: 1, requestKey: input.requestKey, updatedAt: timestamp});
        return {record, created: true};
      });
    },

    recordProviderReceipt: async (key: string, providerJobId: string): Promise<CharacterImageSubmissionRecord> => {
      const initial = readRecord(key);
      if (!initial) throw new Error('Character image submission claim not found.');
      return withProjectLock(initial.projectId, () => {
        const previous = readRecord(key);
        if (!previous) throw new Error('Character image submission claim not found.');
        if (previous.status === 'uncertain') throw new Error('Uncertain character image submission requires explicit recovery.');
        if (previous.providerJobId && previous.providerJobId !== providerJobId) throw new Error('Character image request already has a different provider receipt.');
        if (previous.status === 'queued' && previous.providerJobId === providerJobId) return previous;
        return persist(previous, {status: 'queued', providerJobId, lastError: undefined});
      });
    },

    markUncertain: async (key: string, reason: string, providerJobId?: string): Promise<CharacterImageSubmissionRecord> => {
      const initial = readRecord(key);
      if (!initial) throw new Error('Character image submission claim not found.');
      return withProjectLock(initial.projectId, () => {
        const previous = readRecord(key);
        if (!previous) throw new Error('Character image submission claim not found.');
        return persist(previous, {status: 'uncertain', lastError: reason, ...(providerJobId ? {providerJobId} : {})});
      });
    },

    markCompleted: async (key: string, assetId: string): Promise<CharacterImageSubmissionRecord> => {
      const initial = readRecord(key);
      if (!initial) throw new Error('Character image submission claim not found.');
      return withProjectLock(initial.projectId, () => persist(readRecord(key)!, {status: 'completed', assetId, lastError: undefined}));
    },

    markFailed: async (key: string, reason: string): Promise<CharacterImageSubmissionRecord> => {
      const initial = readRecord(key);
      if (!initial) throw new Error('Character image submission claim not found.');
      return withProjectLock(initial.projectId, () => persist(readRecord(key)!, {status: 'failed', lastError: reason}));
    },

    findByProviderJob: async (projectId: string, providerJobId: string): Promise<CharacterImageSubmissionRecord | undefined> =>
      readdirSync(recordsDirectory, {withFileTypes: true})
        .filter((entry) => entry.isFile() && HEX64.test(entry.name.replace(/\.json$/, '')))
        .map((entry) => readRecord(entry.name.slice(0, -5)))
        .find((record): record is CharacterImageSubmissionRecord => Boolean(record && record.projectId === projectId && record.providerJobId === providerJobId)),
  };
};

export type FilesystemCharacterImageSubmissionRepository = ReturnType<typeof createFilesystemCharacterImageSubmissionRepository>;
