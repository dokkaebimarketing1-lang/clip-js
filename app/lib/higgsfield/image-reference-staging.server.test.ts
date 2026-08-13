import {afterEach, describe, expect, it} from 'vitest';
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {extname, join} from 'node:path';
import {tmpdir} from 'node:os';
import {stageHiggsfieldImageReferences} from './image-reference-staging.server';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });

describe('Higgsfield image reference staging', () => {
  it('creates extension-correct aliases for managed bin objects and removes them on cleanup', () => {
    const root = mkdtempSync(join(tmpdir(), 'clipjs-higgs-staging-'));
    roots.push(root);
    const source = join(root, 'managed-object.bin');
    writeFileSync(source, 'verified-image-bytes');

    const staged = stageHiggsfieldImageReferences([
      {assetId: `ga_${'1'.repeat(32)}`, sourcePath: source, mimeType: 'image/png'},
    ]);

    expect(staged.paths).toHaveLength(1);
    expect(extname(staged.paths[0])).toBe('.png');
    expect(existsSync(staged.paths[0])).toBe(true);
    expect(staged.paths[0]).not.toBe(source);

    staged.cleanup();
    expect(existsSync(staged.paths[0])).toBe(false);
    expect(existsSync(source)).toBe(true);
  });

  it('rejects unsupported image MIME before creating aliases', () => {
    const root = mkdtempSync(join(tmpdir(), 'clipjs-higgs-staging-'));
    roots.push(root);
    const source = join(root, 'managed-object.bin');
    writeFileSync(source, 'bytes');

    expect(() => stageHiggsfieldImageReferences([
      {assetId: `ga_${'2'.repeat(32)}`, sourcePath: source, mimeType: 'image/gif'},
    ])).toThrow('Unsupported Higgsfield image reference MIME');
  });
});
