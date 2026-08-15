import {afterEach, describe, expect, it} from 'vitest';
import {existsSync, mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  computeCharacterImageRequestKey,
  createFilesystemCharacterImageSubmissionRepository,
} from './character-image-submission-repository.server';
import {stableStringify} from '@/app/lib/workflow/hash';

const directories: string[] = [];
const directory = () => {
  const path = mkdtempSync(join(tmpdir(), 'clipjs-character-image-claims-'));
  directories.push(path);
  return path;
};
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, {recursive: true, force: true})));

const requestHash = 'a'.repeat(64);
const input = (requestKey: string, attemptId = '11111111-1111-4111-8111-111111111111') => ({
  projectId: 'project-1',
  characterId: 'CHAR01',
  attemptId,
  requestKey,
  requestHash,
  styleBibleHash: 'b'.repeat(64),
  styleReferenceImageIds: [] as string[],
});

describe('filesystem character image submission repository', () => {
  it('atomically gives one concurrent request ownership of the paid provider submission', async () => {
    const root = directory();
    const first = createFilesystemCharacterImageSubmissionRepository({rootDirectory: root});
    const second = createFilesystemCharacterImageSubmissionRepository({rootDirectory: root});
    const key = computeCharacterImageRequestKey('project-1', '11111111-1111-4111-8111-111111111111', requestHash);

    const results = await Promise.all([first.claim(input(key)), second.claim(input(key))]);

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results.every((result) => result.record.status === 'submitting')).toBe(true);
  });

  it('keeps an uncertain provider response non-replayable and locks the project billing scope', async () => {
    const repository = createFilesystemCharacterImageSubmissionRepository({rootDirectory: directory()});
    const key = computeCharacterImageRequestKey('project-1', '11111111-1111-4111-8111-111111111111', requestHash);
    await repository.claim(input(key));
    await repository.markUncertain(key, 'provider response lost');

    const replay = await repository.claim(input(key));
    expect(replay.created).toBe(false);
    expect(replay.record.status).toBe('uncertain');

    const secondHash = 'c'.repeat(64);
    const secondKey = computeCharacterImageRequestKey('project-1', '22222222-2222-4222-8222-222222222222', secondHash);
    await expect(repository.claim({...input(secondKey, '22222222-2222-4222-8222-222222222222'), requestHash: secondHash}))
      .rejects.toThrow(/billing scope/i);
  });

  it('recovers a durable provider receipt after creating a new repository instance', async () => {
    const root = directory();
    const first = createFilesystemCharacterImageSubmissionRepository({rootDirectory: root});
    const key = computeCharacterImageRequestKey('project-1', '11111111-1111-4111-8111-111111111111', requestHash);
    await first.claim(input(key));
    await first.recordProviderReceipt(key, '4e97908e-4b6d-413a-96e8-d64c560267bc');

    const restarted = createFilesystemCharacterImageSubmissionRepository({rootDirectory: root});
    const recovered = await restarted.findByProviderJob('project-1', '4e97908e-4b6d-413a-96e8-d64c560267bc');

    expect(recovered).toMatchObject({requestKey: key, characterId: 'CHAR01', status: 'queued'});
  });

  it('never evicts an existing lock automatically, even when recovery requires operator action', async () => {
    const root = directory();
    const repository = createFilesystemCharacterImageSubmissionRepository({rootDirectory: root, lockWaitMs: 20});
    const scopeKey = createHash('sha256').update(stableStringify({scope: 'character-image-project', projectId: 'project-1'})).digest('hex');
    const lock = join(root, 'locks', scopeKey);
    mkdirSync(lock);
    const key = computeCharacterImageRequestKey('project-1', '11111111-1111-4111-8111-111111111111', requestHash);

    await expect(repository.claim(input(key))).rejects.toThrow(/busy/i);
    expect(existsSync(lock)).toBe(true);
  });
});
