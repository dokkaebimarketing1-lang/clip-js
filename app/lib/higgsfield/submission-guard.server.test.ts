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

  it('bounds distinct paid submissions to one running and one queued request', async () => {
    let release!: (value: unknown) => void;
    const submit = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const guarded = createHiggsfieldSubmissionGuard({submit, maxPending: 2, cacheFilePath: null});
    const first = guarded(key('a'), request);
    const second = guarded(key('b'), request);
    await expect(guarded(key('c'), request)).rejects.toThrow('queue is full');
    release({id: 'job-1'});
    await first;
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    release({id: 'job-2'});
    await second;
  });
});
