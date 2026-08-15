import {createHash} from 'node:crypto';
import {createServerRedis} from '@/app/lib/storage/redis.server';
import {
  CharacterImageSubmissionConflictError,
  computeCharacterImageRequestKey,
  parseCharacterImageSubmissionRecord,
  type CharacterImageSubmissionRecord,
  type CharacterImageSubmissionRepository,
} from './character-image-submission-repository.server';
import {stableStringify} from '@/app/lib/workflow/hash';

export interface RedisCharacterImageClient {
  // Redis EVAL is required for one atomic claim. Scripts are module constants;
  // all untrusted values are passed separately as KEYS/ARGV and never interpolated.
  eval(script: string, keys: string[], args: unknown[]): Promise<unknown>;
  get(key: string): Promise<unknown>;
}

const CLAIM_SCRIPT = `
local attemptJson = redis.call('GET', KEYS[3])
if attemptJson then
  local attempt = cjson.decode(attemptJson)
  if attempt.requestKey ~= ARGV[1] or attempt.requestHash ~= ARGV[2] then
    return {-2, attemptJson}
  end
end
local activeJson = redis.call('GET', KEYS[1])
if activeJson then
  local active = cjson.decode(activeJson)
  if active.status == 'submitting' or active.status == 'queued' or active.status == 'uncertain' then
    if active.requestKey == ARGV[1] or (active.requestHash == ARGV[2] and active.characterId == ARGV[3]) then
      return {0, activeJson}
    end
    return {-1, activeJson}
  end
end
local existingJson = redis.call('GET', KEYS[2])
if existingJson then
  local existing = cjson.decode(existingJson)
  if existing.projectId ~= ARGV[4] or existing.attemptId ~= ARGV[5] or existing.requestHash ~= ARGV[2] then
    return {-2, existingJson}
  end
  return {0, existingJson}
end
redis.call('SET', KEYS[2], ARGV[6])
redis.call('SET', KEYS[1], ARGV[6])
redis.call('SET', KEYS[3], cjson.encode({requestKey=ARGV[1], requestHash=ARGV[2]}))
return {1, ARGV[6]}
`;

const RECEIPT_SCRIPT = `
local previousJson = redis.call('GET', KEYS[1])
if not previousJson then return {-1, ''} end
local previous = cjson.decode(previousJson)
if previous.providerJobId and previous.providerJobId ~= ARGV[1] then return {-3, previousJson} end
local providerOwner = redis.call('GET', KEYS[3])
if providerOwner and providerOwner ~= previous.requestKey then return {-4, previousJson} end
if previous.status == 'queued' and previous.providerJobId == ARGV[1] then
  redis.call('SET', KEYS[3], previous.requestKey)
  return {0, previousJson}
end
previous.status = 'queued'
previous.providerJobId = ARGV[1]
previous.lastError = nil
previous.revision = previous.revision + 1
previous.updatedAt = ARGV[2]
local nextJson = cjson.encode(previous)
redis.call('SET', KEYS[1], nextJson)
local activeJson = redis.call('GET', KEYS[2])
if activeJson then
  local active = cjson.decode(activeJson)
  if active.requestKey == previous.requestKey then redis.call('SET', KEYS[2], nextJson) end
end
redis.call('SET', KEYS[3], previous.requestKey)
return {1, nextJson}
`;

const TRANSITION_SCRIPT = `
local previousJson = redis.call('GET', KEYS[1])
if not previousJson then return {-1, ''} end
local previous = cjson.decode(previousJson)
if ARGV[2] ~= '' then
  local providerOwner = redis.call('GET', KEYS[3])
  if providerOwner and providerOwner ~= previous.requestKey then return {-4, previousJson} end
end
previous.status = ARGV[1]
if ARGV[2] ~= '' then previous.providerJobId = ARGV[2] end
if ARGV[3] ~= '' then previous.assetId = ARGV[3] end
if ARGV[4] ~= '' then previous.lastError = ARGV[4] else previous.lastError = nil end
previous.revision = previous.revision + 1
previous.updatedAt = ARGV[5]
local nextJson = cjson.encode(previous)
redis.call('SET', KEYS[1], nextJson)
local activeJson = redis.call('GET', KEYS[2])
if activeJson then
  local active = cjson.decode(activeJson)
  if active.requestKey == previous.requestKey then
    if ARGV[1] == 'completed' or ARGV[1] == 'failed' then
      redis.call('DEL', KEYS[2])
    else
      redis.call('SET', KEYS[2], nextJson)
    end
  end
end
if ARGV[2] ~= '' then redis.call('SET', KEYS[3], previous.requestKey) end
return {1, nextJson}
`;

const sha256 = (value: unknown) => createHash('sha256').update(stableStringify(value)).digest('hex');
const parseStoredRecord = (value: unknown): CharacterImageSubmissionRecord | undefined => {
  if (value === null || value === undefined) return undefined;
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  return parseCharacterImageSubmissionRecord(parsed);
};
const parseAttemptRequestKey = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object' || !('requestKey' in parsed)) return undefined;
  return typeof parsed.requestKey === 'string' ? parsed.requestKey : undefined;
};
const parseEvalPair = (value: unknown): [number, string] => {
  if (!Array.isArray(value) || value.length !== 2) throw new Error('Invalid Redis character-image repository response.');
  const code = Number(value[0]);
  const json = typeof value[1] === 'string' ? value[1] : JSON.stringify(value[1]);
  if (!Number.isInteger(code)) throw new Error('Invalid Redis character-image repository status.');
  return [code, json];
};

export const createRedisCharacterImageSubmissionRepository = (options: {
  redis?: RedisCharacterImageClient;
  keyPrefix?: string;
} = {}): CharacterImageSubmissionRepository => {
  const redis = options.redis ?? createServerRedis({automaticDeserialization: false});
  const prefix = (options.keyPrefix ?? 'clipjs:character-image:v1').replace(/:+$/, '');
  const recordKey = (key: string) => `${prefix}:record:${key}`;
  const activeKey = (projectId: string) => `${prefix}:active:${sha256({scope: 'character-image-project', projectId})}`;
  const attemptKey = (projectId: string, attemptId: string) => `${prefix}:attempt:${sha256({projectId, attemptId})}`;
  const providerKey = (projectId: string, providerJobId: string) => `${prefix}:provider:${sha256({projectId, providerJobId})}`;

  const transition = async (key: string, status: CharacterImageSubmissionRecord['status'], options: {
    providerJobId?: string;
    assetId?: string;
    lastError?: string;
  } = {}) => {
    const previous = await repository.get(key);
    if (!previous) throw new Error('Character image submission claim not found.');
    const [code, json] = parseEvalPair(await redis.eval(TRANSITION_SCRIPT,
      [recordKey(key), activeKey(previous.projectId), providerKey(previous.projectId, options.providerJobId ?? 'none')],
      [status, options.providerJobId ?? '', options.assetId ?? '', options.lastError ?? '', new Date().toISOString()]));
    if (code === -4) throw new Error('Character image provider receipt is already owned by another request.');
    if (code < 0 || !json) throw new Error('Character image submission claim not found.');
    return parseStoredRecord(json)!;
  };

  const repository: CharacterImageSubmissionRepository = {
    get: async (key) => parseStoredRecord(await redis.get(recordKey(key))),

    claim: async (input) => {
      const expectedKey = computeCharacterImageRequestKey(input.projectId, input.attemptId, input.requestHash);
      if (expectedKey !== input.requestKey) throw new Error('Character image request key does not match its identity.');
      const timestamp = new Date().toISOString();
      const initial = parseCharacterImageSubmissionRecord({...input, version: 1, revision: 0, status: 'submitting', createdAt: timestamp, updatedAt: timestamp});
      const [code, json] = parseEvalPair(await redis.eval(CLAIM_SCRIPT,
        [activeKey(input.projectId), recordKey(input.requestKey), attemptKey(input.projectId, input.attemptId)],
        [input.requestKey, input.requestHash, input.characterId, input.projectId, input.attemptId, JSON.stringify(initial)]));
      if (code === -2) throw new CharacterImageSubmissionConflictError('ATTEMPT_ID_REUSED', 'Character image attempt ID was reused with a different request.');
      const existing = parseStoredRecord(json)!;
      if (code === -1) throw new CharacterImageSubmissionConflictError('BILLING_SCOPE_LOCKED', `Character image provider billing scope is locked by unresolved request ${existing.requestKey}.`);
      if (code !== 0 && code !== 1) throw new Error('Invalid Redis character-image claim result.');
      return {record: existing, created: code === 1};
    },

    recordProviderReceipt: async (key, providerJobId) => {
      const previous = await repository.get(key);
      if (!previous) throw new Error('Character image submission claim not found.');
      const [code, json] = parseEvalPair(await redis.eval(RECEIPT_SCRIPT,
        [recordKey(key), activeKey(previous.projectId), providerKey(previous.projectId, providerJobId)],
        [providerJobId, new Date().toISOString()]));
      if (code === -3) throw new Error('Character image request already has a different provider receipt.');
      if (code === -4) throw new Error('Character image provider receipt is already owned by another request.');
      if (code < 0 || !json) throw new Error('Character image submission claim not found.');
      return parseStoredRecord(json)!;
    },

    markUncertain: (key, reason, providerJobId) => transition(key, 'uncertain', {lastError: reason, providerJobId}),
    markCompleted: (key, assetId) => transition(key, 'completed', {assetId}),
    markFailed: (key, reason) => transition(key, 'failed', {lastError: reason}),

    findByAttempt: async (projectId, attemptId) => {
      const requestKey = parseAttemptRequestKey(await redis.get(attemptKey(projectId, attemptId)));
      return requestKey ? repository.get(requestKey) : undefined;
    },

    findByProviderJob: async (projectId, providerJobId) => {
      const key = await redis.get(providerKey(projectId, providerJobId));
      return typeof key === 'string' ? repository.get(key) : undefined;
    },
  };

  return repository;
};
