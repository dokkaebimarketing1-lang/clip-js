import {randomUUID} from 'node:crypto';
import {Redis} from '@upstash/redis';
import {z} from 'zod';
import {createServerRedis} from '@/app/lib/storage/redis.server';

const workerJobSchema = z.object({
  version: z.literal(1),
  requestKey: z.string().regex(/^[a-f0-9]{64}$/),
  projectId: z.string().min(1).max(128),
  characterId: z.string().regex(/^CHAR\d{2}$/),
  attemptId: z.string().uuid(),
  prompt: z.string().min(10).max(4000),
  model: z.literal('nano_banana_2_lite'),
  aspectRatio: z.literal('16:9'),
  resolution: z.literal('1k'),
  thinking: z.literal('HIGH'),
  expectedCredits: z.literal(1),
  styleBibleHash: z.string().regex(/^[a-f0-9]{64}$/),
  styleReferenceImageIds: z.array(z.string()).max(14),
  status: z.enum(['pending', 'leased', 'prepared', 'submitted', 'uncertain', 'completed', 'failed']),
  leaseToken: z.string().uuid().optional(),
  leaseExpiresAt: z.number().int().positive().optional(),
  providerJobId: z.string().uuid().optional(),
  lastError: z.string().max(4000).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export type CharacterImageWorkerJob = z.infer<typeof workerJobSchema>;
export type CharacterImageWorkerJobInput = Pick<CharacterImageWorkerJob,
  'requestKey' | 'projectId' | 'characterId' | 'attemptId' | 'prompt' | 'model' | 'aspectRatio' | 'resolution' | 'thinking' | 'expectedCredits' | 'styleBibleHash' | 'styleReferenceImageIds'>;

const ENQUEUE = `
local existing = redis.call('GET', KEYS[2])
if existing then return {0, existing} end
redis.call('SET', KEYS[2], ARGV[1])
redis.call('ZADD', KEYS[1], ARGV[2], KEYS[2])
return {1, ARGV[1]}
`;
const CLAIM = `
local candidates = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 1)
if #candidates == 0 then return {0, ''} end
local jobKey = candidates[1]
local json = redis.call('GET', jobKey)
if not json then redis.call('ZREM', KEYS[1], jobKey) return {0, ''} end
local job = cjson.decode(json)
local recoverable = job.status == 'leased' or (job.providerJobId and job.status == 'submitted')
if job.status ~= 'pending' and not recoverable then redis.call('ZREM', KEYS[1], jobKey) return {0, ''} end
job.status = 'leased'
job.leaseToken = ARGV[2]
job.leaseExpiresAt = tonumber(ARGV[3])
job.updatedAt = ARGV[4]
local nextJson = cjson.encode(job)
redis.call('SET', jobKey, nextJson)
redis.call('ZADD', KEYS[1], ARGV[3], jobKey)
return {1, nextJson}
`;
const UPDATE = `
local json = redis.call('GET', KEYS[2])
if not json then return {-1, ''} end
local job = cjson.decode(json)
if ARGV[1] ~= '' and job.leaseToken ~= ARGV[1] then return {-2, json} end
job.status = ARGV[2]
if ARGV[3] ~= '' then job.providerJobId = ARGV[3] end
if ARGV[4] ~= '' then job.lastError = ARGV[4] else job.lastError = nil end
job.updatedAt = ARGV[5]
job.leaseToken = nil
job.leaseExpiresAt = nil
local nextJson = cjson.encode(job)
redis.call('SET', KEYS[2], nextJson)
if ARGV[2] == 'pending' then redis.call('ZADD', KEYS[1], ARGV[6], KEYS[2]) else redis.call('ZREM', KEYS[1], KEYS[2]) end
return {1, nextJson}
`;
const PREPARE_SUBMIT = `
local json = redis.call('GET', KEYS[2])
if not json then return {-1, ''} end
local job = cjson.decode(json)
if job.status == 'prepared' and job.leaseToken == ARGV[1] then return {0, json} end
if job.status ~= 'leased' or job.leaseToken ~= ARGV[1] then return {-2, json} end
job.status = 'prepared'
job.updatedAt = ARGV[2]
local nextJson = cjson.encode(job)
redis.call('SET', KEYS[2], nextJson)
redis.call('ZREM', KEYS[1], KEYS[2])
return {1, nextJson}
`;
const RECORD_RECEIPT = `
local json = redis.call('GET', KEYS[2])
if not json then return {-1, ''} end
local job = cjson.decode(json)
if job.status == 'submitted' and job.providerJobId == ARGV[2] then return {0, json} end
if job.status ~= 'prepared' or job.leaseToken ~= ARGV[1] then return {-2, json} end
job.status = 'submitted'
job.providerJobId = ARGV[2]
job.updatedAt = ARGV[3]
job.leaseToken = nil
job.leaseExpiresAt = nil
local nextJson = cjson.encode(job)
redis.call('SET', KEYS[2], nextJson)
redis.call('ZADD', KEYS[1], ARGV[4], KEYS[2])
return {1, nextJson}
`;

const pair = (value: unknown): [number, string] => {
  if (!Array.isArray(value) || value.length !== 2) throw new Error('Invalid worker queue response.');
  return [Number(value[0]), typeof value[1] === 'string' ? value[1] : JSON.stringify(value[1])];
};
const parse = (value: unknown): CharacterImageWorkerJob | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  return workerJobSchema.parse(typeof value === 'string' ? JSON.parse(value) : value);
};

export const createCharacterImageWorkerQueue = (options: {redis?: Redis; keyPrefix?: string} = {}) => {
  const redis = options.redis ?? createServerRedis({automaticDeserialization: false});
  const prefix = (options.keyPrefix ?? 'clipjs:higgsfield-worker:v1').replace(/:+$/, '');
  const queueKey = `${prefix}:ready`;
  const jobKey = (requestKey: string) => `${prefix}:job:${requestKey}`;
  return {
    get: async (requestKey: string) => parse(await redis.get(jobKey(requestKey))),
    enqueue: async (input: CharacterImageWorkerJobInput) => {
      const now = new Date().toISOString();
      const job = workerJobSchema.parse({...input, version: 1, status: 'pending', createdAt: now, updatedAt: now});
      const [code, json] = pair(await redis.eval(ENQUEUE, [queueKey, jobKey(input.requestKey)], [JSON.stringify(job), Date.now()]));
      if (code !== 0 && code !== 1) throw new Error('Worker job enqueue failed.');
      const stored = parse(json)!;
      const exact = stored.requestKey === input.requestKey
        && stored.projectId === input.projectId
        && stored.characterId === input.characterId
        && stored.attemptId === input.attemptId
        && stored.prompt === input.prompt
        && stored.styleBibleHash === input.styleBibleHash
        && JSON.stringify(stored.styleReferenceImageIds) === JSON.stringify(input.styleReferenceImageIds)
        && stored.model === input.model
        && stored.aspectRatio === input.aspectRatio
        && stored.resolution === input.resolution
        && stored.thinking === input.thinking;
      if (!exact) throw new Error('Character-image worker request identity collision detected.');
      return {created: code === 1, job: stored};
    },
    claim: async (leaseMs = 120_000) => {
      const leaseToken = randomUUID();
      const now = Date.now();
      const [code, json] = pair(await redis.eval(CLAIM, [queueKey], [now, leaseToken, now + leaseMs, new Date(now).toISOString()]));
      return code === 1 ? parse(json) : undefined;
    },
    prepareSubmit: async (requestKey: string, leaseToken: string) => {
      const now = new Date().toISOString();
      const [code, json] = pair(await redis.eval(PREPARE_SUBMIT, [queueKey, jobKey(requestKey)], [leaseToken, now]));
      if (code === -1) throw new Error('Higgsfield worker job not found.');
      if (code === -2) throw new Error('Higgsfield worker lease is not valid for paid submission preparation.');
      return parse(json);
    },
    recordReceipt: async (requestKey: string, leaseToken: string, providerJobId: string) => {
      const now = Date.now();
      const [code, json] = pair(await redis.eval(RECORD_RECEIPT, [queueKey, jobKey(requestKey)], [leaseToken, providerJobId, new Date(now).toISOString(), now]));
      if (code === -2) throw new Error('Worker lease is stale.');
      if (code !== 0 && code !== 1) throw new Error('Worker job not found.');
      return parse(json)!;
    },
    update: async (requestKey: string, leaseToken: string | undefined, status: CharacterImageWorkerJob['status'], options: {providerJobId?: string; lastError?: string} = {}) => {
      const [code, json] = pair(await redis.eval(UPDATE, [queueKey, jobKey(requestKey)], [leaseToken ?? '', status, options.providerJobId ?? '', options.lastError ?? '', new Date().toISOString(), Date.now()]));
      if (code === -2) throw new Error('Worker lease is stale.');
      if (code !== 1) throw new Error('Worker job not found.');
      return parse(json)!;
    },
  };
};
