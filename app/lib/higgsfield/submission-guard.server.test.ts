import {describe, expect, it, vi} from 'vitest';
import {createHiggsfieldSubmissionGuard} from './submission-guard.server';
import type {HiggsfieldSeedanceRequest} from '@/app/lib/workflow/seedance-master';

const request: HiggsfieldSeedanceRequest = {
  prompt: '测试',
  mode: 't2v',
  duration: 30,
  aspect_ratio: '16:9',
  resolution: '720p',
  generate_audio: false,
};
const key = (character: string) => character.repeat(64);

describe('Higgsfield submission guard', () => {
  it('coalesces duplicate in-flight submissions and reuses the completed job', async () => {
    let release!: (value: unknown) => void;
    const submit = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const guarded = createHiggsfieldSubmissionGuard({submit, cacheFilePath: null});
    const first = guarded(key('a'), request);
    const duplicate = guarded(key('a'), request);
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    release({id: 'job-1'});
    await expect(first).resolves.toEqual({job: {id: 'job-1'}, reused: false});
    await expect(duplicate).resolves.toEqual({job: {id: 'job-1'}, reused: true});
    await expect(guarded(key('a'), request)).resolves.toEqual({job: {id: 'job-1'}, reused: true});
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('allows only one distinct paid submission at a time', async () => {
    let release!: (value: unknown) => void;
    const submit = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
      .mockResolvedValueOnce({id: 'job-2'});
    const guarded = createHiggsfieldSubmissionGuard({submit, maxPending: 1, cacheFilePath: null});
    const first = guarded(key('a'), request);
    await expect(guarded(key('b'), request)).rejects.toThrow('queue is full');
    release({id: 'job-1'});
    await first;
    await expect(guarded(key('b'), request)).resolves.toEqual({job: {id: 'job-2'}, reused: false});
  });
});
