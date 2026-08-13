import {copyFileSync, existsSync, linkSync, lstatSync, mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

type ManagedImageReference = {assetId: string; sourcePath: string; mimeType: string};
type StagedImageReferences = {paths: string[]; cleanup: () => void};

export const stageHiggsfieldImageReferences = (references: ManagedImageReference[]): StagedImageReferences => {
  if (references.length > 14) throw new Error('Higgsfield accepts at most 14 image references.');
  const root = mkdtempSync(join(tmpdir(), 'clipjs-higgsfield-refs-'));
  const cleanup = () => rmSync(root, {recursive: true, force: true});
  try {
    const paths = references.map((reference, index) => {
      const extension = EXTENSION_BY_MIME[reference.mimeType];
      if (!extension) throw new Error('Unsupported Higgsfield image reference MIME.');
      if (!/^ga_[a-f0-9]{32}$/.test(reference.assetId) || !existsSync(reference.sourcePath)) throw new Error('Invalid managed Higgsfield image reference.');
      const source = realpathSync(reference.sourcePath);
      if (!lstatSync(source).isFile()) throw new Error('Higgsfield image reference must be a regular file.');
      const destination = resolve(root, `${index}-${reference.assetId}${extension}`);
      try { linkSync(source, destination); } catch { copyFileSync(source, destination); }
      return destination;
    });
    return {paths, cleanup};
  } catch (error) {
    cleanup();
    throw error;
  }
};
