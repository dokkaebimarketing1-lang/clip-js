import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {createLocalGeneratedAssetStore} from './generated-asset-store.server';

const roots: string[] = [];
const root = () => {
  const value = mkdtempSync(join(tmpdir(), 'clipjs-assets-'));
  roots.push(value);
  return value;
};
afterEach(() => roots.splice(0).forEach((value) => rmSync(value, {recursive: true, force: true})));

const bytes = Buffer.from('verified fake mp4 bytes');
const sha = createHash('sha256').update(bytes).digest('hex');
const media = {container: 'mp4', videoCodec: 'h264', width: 1280, height: 720, fps: 24, durationSeconds: 30, videoStreams: 1, audioStreams: 0} as const;

const writeTemp = (store: ReturnType<typeof createLocalGeneratedAssetStore>, name: string, data = bytes) => {
  const path = store.createTempPath(name);
  writeFileSync(path, data);
  return path;
};

describe('local generated asset store', () => {
  it('commits a verified temp idempotently and deduplicates object bytes across requests', async () => {
    const store = createLocalGeneratedAssetStore({rootDirectory: root(), minFreeBytes: 0, getFreeBytes: () => 1_000_000});
    const first = await store.commitVerifiedTemp({
      tempPath: writeTemp(store, 'first'), projectId: 'project-1', requestKey: 'a'.repeat(64),
      contentSha256: sha, byteLength: bytes.length, mimeType: 'video/mp4', media,
    });
    expect(first.created).toBe(true);
    expect(readFileSync(store.resolveLocalPath(first.asset.id))).toEqual(bytes);

    const retry = await store.commitVerifiedTemp({
      tempPath: writeTemp(store, 'retry'), projectId: 'project-1', requestKey: 'a'.repeat(64),
      contentSha256: sha, byteLength: bytes.length, mimeType: 'video/mp4', media,
    });
    expect(retry).toMatchObject({created: false, asset: {id: first.asset.id}});

    const secondRequest = await store.commitVerifiedTemp({
      tempPath: writeTemp(store, 'second'), projectId: 'project-1', requestKey: 'b'.repeat(64),
      contentSha256: sha, byteLength: bytes.length, mimeType: 'video/mp4', media,
    });
    expect(secondRequest.asset.id).not.toBe(first.asset.id);
    expect(secondRequest.asset.objectRelativePath).toBe(first.asset.objectRelativePath);
    expect(await store.listProject('project-1')).toHaveLength(2);
  });

  it('rejects hash mismatch, traversal, quotas, and low disk without publishing metadata', async () => {
    const store = createLocalGeneratedAssetStore({
      rootDirectory: root(), maxProjectBytes: bytes.length, maxTotalBytes: bytes.length * 2,
      minFreeBytes: 10, getFreeBytes: () => 1_000_000,
    });
    await expect(store.commitVerifiedTemp({
      tempPath: writeTemp(store, 'bad-hash'), projectId: 'project-1', requestKey: 'c'.repeat(64),
      contentSha256: '0'.repeat(64), byteLength: bytes.length, mimeType: 'video/mp4', media,
    })).rejects.toThrow(/sha-256/i);
    expect(() => store.resolveLocalPath('../escape')).toThrow(/asset id/i);

    await store.commitVerifiedTemp({
      tempPath: writeTemp(store, 'quota-1'), projectId: 'project-1', requestKey: 'd'.repeat(64),
      contentSha256: sha, byteLength: bytes.length, mimeType: 'video/mp4', media,
    });
    const other = Buffer.from('different verified bytes');
    const otherSha = createHash('sha256').update(other).digest('hex');
    await expect(store.commitVerifiedTemp({
      tempPath: writeTemp(store, 'quota-2', other), projectId: 'project-1', requestKey: 'e'.repeat(64),
      contentSha256: otherSha, byteLength: other.length, mimeType: 'video/mp4', media,
    })).rejects.toThrow(/project quota/i);

    const lowDisk = createLocalGeneratedAssetStore({rootDirectory: root(), minFreeBytes: 100, getFreeBytes: () => 50});
    await expect(lowDisk.commitVerifiedTemp({
      tempPath: writeTemp(lowDisk, 'low-disk'), projectId: 'project-2', requestKey: 'f'.repeat(64),
      contentSha256: sha, byteLength: bytes.length, mimeType: 'video/mp4', media,
    })).rejects.toThrow(/free disk/i);
  });

  it('reports and optionally removes stale temp and orphan objects without touching metadata claims', async () => {
    const store = createLocalGeneratedAssetStore({rootDirectory: root(), minFreeBytes: 0, getFreeBytes: () => 1_000_000, tempRetentionMs: 0});
    writeTemp(store, 'stale');
    const orphanPath = join(store.objectsDirectory, `${'1'.repeat(64)}.bin`);
    writeFileSync(orphanPath, bytes);
    const dryRun = await store.reconcile({apply: false, now: new Date(Date.now() + 1_000)});
    expect(dryRun.staleTemp).toHaveLength(1);
    expect(dryRun.orphanObjects).toContain(orphanPath);
    expect(readFileSync(orphanPath)).toEqual(bytes);

    const applied = await store.reconcile({apply: true, now: new Date(Date.now() + 2_000)});
    expect(applied.deleted).toEqual(expect.arrayContaining([orphanPath]));
  });
});
