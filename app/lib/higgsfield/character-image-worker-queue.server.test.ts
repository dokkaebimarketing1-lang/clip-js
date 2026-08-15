import {randomUUID} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {createCharacterImageWorkerQueue} from './character-image-worker-queue.server';

const live = process.env.CLIPJS_TEST_LIVE_REDIS === 'true' ? it : it.skip;

describe('character image worker queue', () => {
  live('atomically leases one worker and rejects payload mutation', async () => {
    const queue = createCharacterImageWorkerQueue({keyPrefix: `clipjs:test:worker:${randomUUID()}`});
    const input = {
      requestKey: 'a'.repeat(64),
      projectId: randomUUID(),
      characterId: 'CHAR01',
      attemptId: randomUUID(),
      prompt: 'A complete character reference image prompt for live queue verification.',
      styleBibleHash: 'b'.repeat(64),
      styleReferenceImageIds: [],
      model: 'nano_banana_2_lite' as const,
      aspectRatio: '16:9' as const,
      resolution: '1k' as const,
      thinking: 'HIGH' as const,
      expectedCredits: 1 as const,
    };
    const first = await queue.enqueue(input);
    expect(first.created).toBe(true);
    const duplicate = await queue.enqueue(input);
    expect(duplicate.created).toBe(false);
    await expect(queue.enqueue({...input, prompt: `${input.prompt} changed`})).rejects.toThrow(/identity collision/i);
    const claims = await Promise.all(Array.from({length: 8}, () => queue.claim(20)));
    const leased = claims.filter(Boolean);
    expect(leased).toHaveLength(1);
    expect(leased[0]?.leaseToken).toMatch(/^[a-f0-9-]{36}$/i);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const recoveredBeforeSubmit = await queue.claim(20);
    expect(recoveredBeforeSubmit).toMatchObject({status: 'leased'});
    expect(recoveredBeforeSubmit?.providerJobId).toBeUndefined();
    const providerJobId = randomUUID();
    await expect(queue.recordReceipt(input.requestKey, randomUUID(), providerJobId)).rejects.toThrow(/stale/i);
    await queue.prepareSubmit(input.requestKey, recoveredBeforeSubmit!.leaseToken!);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await queue.claim()).toBeUndefined();
    await queue.recordReceipt(input.requestKey, recoveredBeforeSubmit!.leaseToken!, providerJobId);
    await expect(queue.recordReceipt(input.requestKey, recoveredBeforeSubmit!.leaseToken!, providerJobId)).resolves.toMatchObject({status: 'submitted', providerJobId});
    expect((await queue.get(input.requestKey))?.status).toBe('submitted');
    const recovery = await queue.claim(20);
    expect(recovery).toMatchObject({status: 'leased', providerJobId});
    await new Promise((resolve) => setTimeout(resolve, 30));
    const recoveredAgain = await queue.claim();
    expect(recoveredAgain).toMatchObject({status: 'leased', providerJobId});
    await queue.update(input.requestKey, recoveredAgain!.leaseToken, 'completed', {providerJobId});
    expect(await queue.claim()).toBeUndefined();
  });
});
