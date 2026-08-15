import {randomUUID} from 'node:crypto';
import {Redis} from '@upstash/redis';
import {describe, expect, it, vi} from 'vitest';
import {
  CharacterImageSubmissionConflictError,
  computeCharacterImageRequestKey,
  type CharacterImageSubmissionRecord,
} from './character-image-submission-repository.server';
import {
  createRedisCharacterImageSubmissionRepository,
  type RedisCharacterImageClient,
} from './character-image-submission-redis-repository.server';

const requestHash = 'a'.repeat(64);
const requestKey = computeCharacterImageRequestKey('project-1', '11111111-1111-4111-8111-111111111111', requestHash);
const claim = {
  projectId: 'project-1',
  characterId: 'CHAR01',
  attemptId: '11111111-1111-4111-8111-111111111111',
  requestKey,
  requestHash,
  styleBibleHash: 'b'.repeat(64),
  styleReferenceImageIds: [] as string[],
};
const record = (overrides: Partial<CharacterImageSubmissionRecord> = {}): CharacterImageSubmissionRecord => ({
  version: 1,
  revision: 0,
  ...claim,
  status: 'submitting',
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
  ...overrides,
});

const client = (evalResult: unknown, getResult: unknown = null) => ({
  eval: vi.fn().mockResolvedValue(evalResult),
  get: vi.fn().mockResolvedValue(getResult),
}) satisfies RedisCharacterImageClient;

describe('redis character image submission repository', () => {
  it('accepts exactly one atomic paid-submission claim', async () => {
    const redis = client([1, JSON.stringify(record())]);
    const repository = createRedisCharacterImageSubmissionRepository({redis, keyPrefix: 'test'});

    const result = await repository.claim(claim);

    expect(result).toEqual({created: true, record: record()});
    expect(redis.eval).toHaveBeenCalledOnce();
    const [script, keys] = redis.eval.mock.calls[0];
    expect(script).toContain('cjson.decode');
    expect(keys).toHaveLength(3);
  });

  it('reuses the exact request without creating a second provider submission', async () => {
    const redis = client([0, JSON.stringify(record())]);
    const repository = createRedisCharacterImageSubmissionRepository({redis, keyPrefix: 'test'});

    await expect(repository.claim(claim)).resolves.toEqual({created: false, record: record()});
  });

  it('rejects a different unresolved request in the same project billing scope', async () => {
    const active = record({requestKey: 'c'.repeat(64), requestHash: 'd'.repeat(64)});
    const redis = client([-1, JSON.stringify(active)]);
    const repository = createRedisCharacterImageSubmissionRepository({redis, keyPrefix: 'test'});

    await expect(repository.claim(claim)).rejects.toBeInstanceOf(CharacterImageSubmissionConflictError);
  });

  it('rejects reuse of an attempt ID with a different request identity', async () => {
    const redis = client([-2, JSON.stringify({requestKey, requestHash: 'd'.repeat(64)})]);
    const repository = createRedisCharacterImageSubmissionRepository({redis, keyPrefix: 'test'});

    await expect(repository.claim(claim)).rejects.toMatchObject({code: 'ATTEMPT_ID_REUSED'});
  });

  it('parses the JSON attempt index when Redis deserialization is disabled', async () => {
    const redis = client([0, ''], null);
    redis.get.mockResolvedValueOnce(JSON.stringify({requestKey, requestHash: claim.requestHash})).mockResolvedValueOnce(JSON.stringify(record()));
    const repository = createRedisCharacterImageSubmissionRepository({redis, keyPrefix: 'test'});

    await expect(repository.findByAttempt(claim.projectId, claim.attemptId)).resolves.toEqual(record());
  });

  it('stores and resolves the provider receipt through a durable provider index', async () => {
    const providerJobId = '4e97908e-4b6d-413a-96e8-d64c560267bc';
    const queued = record({revision: 1, status: 'queued', providerJobId});
    const redis = client([1, JSON.stringify(queued)], JSON.stringify(record()));
    const repository = createRedisCharacterImageSubmissionRepository({redis, keyPrefix: 'test'});

    await expect(repository.recordProviderReceipt(requestKey, providerJobId)).resolves.toEqual(queued);
    redis.get.mockResolvedValueOnce(requestKey).mockResolvedValueOnce(JSON.stringify(queued));
    await expect(repository.findByProviderJob('project-1', providerJobId)).resolves.toEqual(queued);
  });

  it.skipIf(process.env.CLIPJS_TEST_LIVE_REDIS !== 'true')('atomically creates one claim across concurrent live Upstash requests', async () => {
    const prefix = `clipjs:test:character-image:${randomUUID()}`;
    const redis = Redis.fromEnv({automaticDeserialization: false});
    const repository = createRedisCharacterImageSubmissionRepository({redis, keyPrefix: prefix});
    try {
      const results = await Promise.all(Array.from({length: 8}, () => repository.claim(claim)));
      expect(results.filter((result) => result.created)).toHaveLength(1);
      expect(new Set(results.map((result) => result.record.requestKey))).toEqual(new Set([requestKey]));

      const changedHash = 'e'.repeat(64);
      const changedClaim = {
        ...claim,
        requestHash: changedHash,
        requestKey: computeCharacterImageRequestKey(claim.projectId, claim.attemptId, changedHash),
      };
      await expect(repository.claim(changedClaim)).rejects.toMatchObject({code: 'ATTEMPT_ID_REUSED'});

      await repository.markFailed(requestKey, 'live-test-terminal');
      const nextAttemptId = randomUUID();
      const nextClaim = {
        ...claim,
        attemptId: nextAttemptId,
        requestKey: computeCharacterImageRequestKey(claim.projectId, nextAttemptId, claim.requestHash),
      };
      await expect(repository.claim(nextClaim)).resolves.toMatchObject({created: true});

      const providerJobId = randomUUID();
      await repository.recordProviderReceipt(nextClaim.requestKey, providerJobId);
      await repository.markFailed(nextClaim.requestKey, 'live-test-provider-terminal');
      const thirdAttemptId = randomUUID();
      const thirdClaim = {
        ...claim,
        attemptId: thirdAttemptId,
        requestKey: computeCharacterImageRequestKey(claim.projectId, thirdAttemptId, claim.requestHash),
      };
      await repository.claim(thirdClaim);
      await expect(repository.recordProviderReceipt(thirdClaim.requestKey, providerJobId))
        .rejects.toThrow(/already owned/i);
    } finally {
      let cursor = 0;
      do {
        const [next, keys] = await redis.scan(cursor, {match: `${prefix}:*`, count: 100});
        cursor = Number(next);
        if (keys.length > 0) await redis.del(...keys);
      } while (cursor !== 0);
    }
  });
});
