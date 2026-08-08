import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {homedir} from 'node:os';
import {createSerialTaskQueue} from '@/app/lib/render/serial-task-queue';
import type {HiggsfieldSeedanceRequest} from '@/app/lib/workflow/seedance-master';

const DEFAULT_CACHE_PATH = join(homedir(), '.clipjs', 'higgsfield-jobs.json');
const MAX_CACHE_ENTRIES = 100;

type Submit = (request: HiggsfieldSeedanceRequest) => Promise<unknown>;
type GuardOptions = {submit: Submit; maxPending?: number; cacheFilePath?: string | null};

type CacheRecord = Record<string, unknown>;

const readCache = (cacheFilePath: string | null): Map<string, unknown> => {
  if (!cacheFilePath || !existsSync(cacheFilePath)) return new Map();
  try {
    const parsed = JSON.parse(readFileSync(cacheFilePath, 'utf8')) as CacheRecord;
    return new Map(Object.entries(parsed).slice(-MAX_CACHE_ENTRIES));
  } catch {
    throw new Error('Higgsfield idempotency cache is unreadable; job submission is blocked to prevent duplicate billing.');
  }
};

const persistCache = (cacheFilePath: string, completed: Map<string, unknown>): void => {
  mkdirSync(dirname(cacheFilePath), {recursive: true});
  const entries = Array.from(completed.entries()).slice(-MAX_CACHE_ENTRIES);
  const temporary = `${cacheFilePath}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(Object.fromEntries(entries)), {encoding: 'utf8', flag: 'w'});
  renameSync(temporary, cacheFilePath);
};

export const computeHiggsfieldIdempotencyKey = (
  projectId: string,
  approvalSignature: string,
  request: HiggsfieldSeedanceRequest,
): string => createHash('sha256').update(JSON.stringify({projectId, approvalSignature, request})).digest('hex');

export const createHiggsfieldSubmissionGuard = (options: GuardOptions) => {
  const cacheFilePath = options.cacheFilePath === undefined
    ? (process.env.CLIPJS_HIGGSFIELD_CACHE_PATH?.trim() || DEFAULT_CACHE_PATH)
    : options.cacheFilePath;
  const completed = readCache(cacheFilePath);
  const inFlight = new Map<string, Promise<unknown>>();
  const queue = createSerialTaskQueue(options.maxPending ?? 2, 'Higgsfield submission queue is full.');

  const ensureWritableCache = () => {
    if (!cacheFilePath || existsSync(cacheFilePath)) return;
    persistCache(cacheFilePath, completed);
  };

  return async (key: string, request: HiggsfieldSeedanceRequest): Promise<{job: unknown; reused: boolean}> => {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid Higgsfield idempotency key.');
    if (completed.has(key)) return {job: completed.get(key), reused: true};
    const existing = inFlight.get(key);
    if (existing) return {job: await existing, reused: true};
    ensureWritableCache();

    const submission = queue(async () => {
      const job = await options.submit(request);
      completed.set(key, job);
      if (cacheFilePath) persistCache(cacheFilePath, completed);
      return job;
    });
    inFlight.set(key, submission);
    try {
      return {job: await submission, reused: false};
    } finally {
      inFlight.delete(key);
    }
  };
};
