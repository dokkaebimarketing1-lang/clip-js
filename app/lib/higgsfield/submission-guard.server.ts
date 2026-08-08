import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createSerialTaskQueue} from '@/app/lib/render/serial-task-queue';
import type {HiggsfieldSeedanceRequest} from '@/app/lib/workflow/seedance-master';

const DEFAULT_CLAIM_DIRECTORY = join(homedir(), '.clipjs', 'higgsfield-claims');

type Submit = (request: HiggsfieldSeedanceRequest) => Promise<unknown>;
type GuardOptions = {submit: Submit; maxPending?: number; claimDirectory?: string};
type Claim = {
  version: 1;
  key: string;
  status: 'submitting' | 'completed' | 'uncertain';
  createdAt: string;
  updatedAt: string;
  job?: unknown;
};
type GuardResult = {job: unknown; reused: boolean};

export class HiggsfieldSubmissionUncertainError extends Error {
  constructor() {
    super('Higgsfield submission state is uncertain; automatic replay is blocked. Reconcile the provider job list, then approve a new attempt explicitly.');
    this.name = 'HiggsfieldSubmissionUncertainError';
  }
}

const claimPath = (directory: string, key: string) => join(directory, `${key}.json`);
const isAlreadyExists = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';

const readClaim = (path: string, key: string): Claim => {
  try {
    const claim = JSON.parse(readFileSync(path, 'utf8')) as Claim;
    if (claim.version !== 1 || claim.key !== key || !['submitting', 'completed', 'uncertain'].includes(claim.status)) throw new Error('invalid claim');
    return claim;
  } catch {
    throw new HiggsfieldSubmissionUncertainError();
  }
};

const createClaim = (directory: string, key: string): Claim | undefined => {
  mkdirSync(directory, {recursive: true});
  const now = new Date().toISOString();
  const claim: Claim = {version: 1, key, status: 'submitting', createdAt: now, updatedAt: now};
  try {
    writeFileSync(claimPath(directory, key), JSON.stringify(claim), {encoding: 'utf8', flag: 'wx'});
    return undefined;
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    return readClaim(claimPath(directory, key), key);
  }
};

const replaceClaim = (directory: string, claim: Claim): void => {
  const destination = claimPath(directory, claim.key);
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, JSON.stringify(claim), {encoding: 'utf8', flag: 'wx'});
  renameSync(temporary, destination);
};

export const computeHiggsfieldIdempotencyKey = (
  projectId: string,
  approvalSignature: string,
  request: HiggsfieldSeedanceRequest,
): string => createHash('sha256').update(JSON.stringify({projectId, approvalSignature, request})).digest('hex');

export const createHiggsfieldSubmissionGuard = (options: GuardOptions) => {
  const directory = options.claimDirectory ?? process.env.CLIPJS_HIGGSFIELD_CLAIM_DIR?.trim() ?? DEFAULT_CLAIM_DIRECTORY;
  const inFlight = new Map<string, Promise<GuardResult>>();
  const queue = createSerialTaskQueue(options.maxPending ?? 1, 'Higgsfield submission queue is full.');

  return async (key: string, request: HiggsfieldSeedanceRequest): Promise<GuardResult> => {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid Higgsfield idempotency key.');
    const existing = inFlight.get(key);
    if (existing) return {...await existing, reused: true};

    const submission = queue(async (): Promise<GuardResult> => {
      const priorClaim = createClaim(directory, key);
      if (priorClaim?.status === 'completed') return {job: priorClaim.job, reused: true};
      if (priorClaim) throw new HiggsfieldSubmissionUncertainError();

      const createdAt = new Date().toISOString();
      try {
        const job = await options.submit(request);
        replaceClaim(directory, {version: 1, key, status: 'completed', createdAt, updatedAt: new Date().toISOString(), job});
        return {job, reused: false};
      } catch (error) {
        try {
          replaceClaim(directory, {version: 1, key, status: 'uncertain', createdAt, updatedAt: new Date().toISOString()});
        } catch {
          // The original atomic "submitting" claim remains and still blocks automatic replay.
        }
        throw error;
      }
    });
    inFlight.set(key, submission);
    try {
      return await submission;
    } finally {
      inFlight.delete(key);
    }
  };
};
