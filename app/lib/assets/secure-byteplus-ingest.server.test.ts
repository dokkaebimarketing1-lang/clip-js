import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
vi.mock('server-only', () => ({}));
import {createLocalGeneratedAssetStore} from './generated-asset-store.server';
import {createSecureBytePlusResultIngestor} from './secure-byteplus-ingest.server';

const directories: string[] = [];
afterEach(() => {
  delete process.env.BYTEPLUS_RESULT_HOSTS;
  directories.splice(0).forEach((directory) => rmSync(directory, {recursive: true, force: true}));
});

describe('secure BytePlus result ingest', () => {
  it('fails before DNS or download when the result host allowlist is absent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clipjs-secure-ingest-'));
    directories.push(root);
    const assetStore = createLocalGeneratedAssetStore({rootDirectory: root, minFreeBytes: 0});
    const ingest = createSecureBytePlusResultIngestor({assetStore});
    const result = ingest({
      projectId: 'project-1',
      requestKey: 'a'.repeat(64),
      providerJobId: 'job-1',
      resultTransportUrl: 'https://results.example.test/private/path?token=secret',
      authorizedDuration: 30,
      authorizedResolution: '720p',
      authorizedGenerateAudio: false,
    });
    await expect(result).rejects.toThrow('BYTEPLUS_RESULT_HOSTS is not configured; observed result hostname: results.example.test');
    await expect(result).rejects.not.toThrow(/private|token=secret/);
    expect(await assetStore.listProject('project-1')).toHaveLength(0);
  });
});
