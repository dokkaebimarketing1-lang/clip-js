import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createHiggsfieldSubmissionGuard} from './submission-guard.server';
import type {HiggsfieldSeedanceRequest} from '@/app/lib/workflow/seedance-master';

const request: HiggsfieldSeedanceRequest = {
  prompt: '测试', mode: 't2v', duration: 30, aspect_ratio: '16:9', resolution: '720p', generate_audio: false,
};
const key = (character: string) => character.repeat(64);
const directories: string[] = [];
const claimDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), 'clipjs-higgsfield-claims-'));
  directories.push(directory);
  return directory;
};
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, {recursive: true, force: true})));

describe('Higgsfield submission guard', () => {
  it('coalesces same-process duplicates and persists the completed job', async () => {
    const directory = claimDirectory();
    let release!: (value: unknown) => void;
    const submit = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const guarded = createHiggsfieldSubmissionGuard({submit, claimDirectory: directory});
    const first = guarded(key('a'), request);
    const duplicate = guarded(key('a'), request);
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    release({id: 'job-1'});
    await expect(first).resolves.toEqual({job: {id: 'job-1'}, reused: false});
    await expect(duplicate).resolves.toEqual({job: {id: 'job-1'}, reused: true});

    const afterRestart = createHiggsfieldSubmissionGuard({submit: vi.fn(), claimDirectory: directory});
    await expect(afterRestart(key('a'), request)).resolves.toEqual({job: {id: 'job-1'}, reused: true});
  });

  it('atomically blocks a second process while provider response is unknown', async () => {
    const directory = claimDirectory();
    let release!: (value: unknown) => void;
    const firstSubmit = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const firstGuard = createHiggsfieldSubmissionGuard({submit: firstSubmit, claimDirectory: directory});
    const first = firstGuard(key('b'), request);
    await vi.waitFor(() => expect(firstSubmit).toHaveBeenCalledTimes(1));

    const secondSubmit = vi.fn();
    const secondGuard = createHiggsfieldSubmissionGuard({submit: secondSubmit, claimDirectory: directory});
    await expect(secondGuard(key('b'), request)).rejects.toThrow(/uncertain/i);
    expect(secondSubmit).not.toHaveBeenCalled();
    release({id: 'job-2'});
    await first;
  });

  it('keeps a failed or timed-out claim uncertain instead of auto-resubmitting', async () => {
    const directory = claimDirectory();
    const firstSubmit = vi.fn().mockRejectedValue(new Error('response lost'));
    const firstGuard = createHiggsfieldSubmissionGuard({submit: firstSubmit, claimDirectory: directory});
    await expect(firstGuard(key('c'), request)).rejects.toThrow('response lost');

    const retrySubmit = vi.fn();
    const retryGuard = createHiggsfieldSubmissionGuard({submit: retrySubmit, claimDirectory: directory});
    await expect(retryGuard(key('c'), request)).rejects.toThrow(/uncertain/i);
    expect(retrySubmit).not.toHaveBeenCalled();
  });

  it('allows only one distinct paid submission at a time', async () => {
    const directory = claimDirectory();
    let release!: (value: unknown) => void;
    const submit = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
      .mockResolvedValueOnce({id: 'job-4'});
    const guarded = createHiggsfieldSubmissionGuard({submit, maxPending: 1, claimDirectory: directory});
    const first = guarded(key('d'), request);
    await expect(guarded(key('e'), request)).rejects.toThrow('queue is full');
    release({id: 'job-3'});
    await first;
    await expect(guarded(key('e'), request)).resolves.toEqual({job: {id: 'job-4'}, reused: false});
  });
});
