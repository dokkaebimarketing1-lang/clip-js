import {createHash, randomUUID} from 'node:crypto';
import {
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  lstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,

  rmSync,
  statfsSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {basename, dirname, join, relative, resolve} from 'node:path';
import {stableStringify} from '@/app/lib/workflow/hash';
import {
  generatedAssetSchema,
  type GeneratedAsset,
  managedMediaMetadataSchema,
  type ManagedMediaMetadataInput,
} from './generated-asset-schema';

const REQUEST_KEY = /^[a-f0-9]{64}$/;
const CONTENT_HASH = /^[a-f0-9]{64}$/;
const ASSET_ID = /^ga_[a-f0-9]{32}$/;
const TEMP_NAME = /^[A-Za-z0-9_-]{1,64}$/;

const isCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === code;

const fsyncDirectory = (path: string): void => {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, 'r');
    fsyncSync(descriptor);
  } catch (error) {
    if (process.platform !== 'win32' || !isCode(error, 'EPERM')) throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
};

const writeExclusiveJson = (path: string, value: unknown): boolean => {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value)}\n`, {encoding: 'utf8'});
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    fsyncDirectory(dirname(path));
    return true;
  } catch (error) {
    if (isCode(error, 'EEXIST')) return false;
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
};

const sha256File = async (path: string): Promise<string> => new Promise((resolveHash, reject) => {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  stream.on('data', (chunk) => hash.update(chunk));
  stream.on('error', reject);
  stream.on('end', () => resolveHash(hash.digest('hex')));
});

const generatedAssetId = (projectId: string, requestKey: string, contentSha256: string): string =>
  `ga_${createHash('sha256').update(stableStringify({projectId, requestKey, contentSha256})).digest('hex').slice(0, 32)}`;

export type CommitVerifiedTempInput = {
  tempPath: string;
  projectId: string;
  requestKey: string;
  providerJobId?: string;
  contentSha256: string;
  byteLength: number;
  assetKind?: 'generated-video' | 'managed-media';
  mimeType: GeneratedAsset['mimeType'];
  media: ManagedMediaMetadataInput;
};

export const createLocalGeneratedAssetStore = (options: {
  rootDirectory: string;
  maxProjectBytes?: number;
  maxTotalBytes?: number;
  minFreeBytes?: number;
  tempRetentionMs?: number;
  getFreeBytes?: () => number;
}) => {
  const rootDirectory = resolve(options.rootDirectory);
  const objectsDirectory = join(rootDirectory, 'objects');
  const metadataDirectory = join(rootDirectory, 'metadata');
  const tempDirectory = join(rootDirectory, 'temp');
  mkdirSync(objectsDirectory, {recursive: true});
  mkdirSync(metadataDirectory, {recursive: true});
  mkdirSync(tempDirectory, {recursive: true});

  const maxProjectBytes = options.maxProjectBytes ?? 10 * 1024 * 1024 * 1024;
  const maxTotalBytes = options.maxTotalBytes ?? 50 * 1024 * 1024 * 1024;
  const minFreeBytes = options.minFreeBytes ?? 1024 * 1024 * 1024;
  const tempRetentionMs = options.tempRetentionMs ?? 24 * 60 * 60 * 1000;
  const getFreeBytes = options.getFreeBytes ?? (() => {
    const stats = statfsSync(rootDirectory);
    return Number(stats.bavail) * Number(stats.bsize);
  });

  const metadataPath = (assetId: string): string => {
    if (!ASSET_ID.test(assetId)) throw new Error('Invalid generated asset id.');
    return join(metadataDirectory, `${assetId}.json`);
  };
  const objectPath = (hash: string): string => {
    if (!CONTENT_HASH.test(hash)) throw new Error('Invalid generated asset SHA-256.');
    return join(objectsDirectory, `${hash}.bin`);
  };
  const readMetadata = (assetId: string): GeneratedAsset | undefined => {
    const path = metadataPath(assetId);
    if (!existsSync(path)) return undefined;
    try {
      return generatedAssetSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    } catch {
      throw new Error(`Generated asset metadata ${assetId} is corrupt.`);
    }
  };
  const listAll = (): GeneratedAsset[] => readdirSync(metadataDirectory, {withFileTypes: true})
    .filter((entry) => entry.isFile() && /^ga_[a-f0-9]{32}\.json$/.test(entry.name))
    .map((entry) => readMetadata(entry.name.slice(0, -5)))
    .filter((asset): asset is GeneratedAsset => Boolean(asset));
  const assertOwnedTemp = (path: string): string => {
    const absolute = resolve(path);
    const pathFromRoot = relative(tempDirectory, absolute);
    if (!pathFromRoot || pathFromRoot.startsWith('..') || resolve(tempDirectory, pathFromRoot) !== absolute) throw new Error('Temp asset path is outside the generated asset store.');
    const stats = lstatSync(absolute);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('Generated asset temp must be a regular file.');
    return absolute;
  };

  return {
    rootDirectory,
    objectsDirectory,
    metadataDirectory,
    tempDirectory,

    createTempPath: (name: string): string => {
      if (!TEMP_NAME.test(name)) throw new Error('Invalid generated asset temp name.');
      return join(tempDirectory, `${name}.${randomUUID()}.part`);
    },

    get: async (assetId: string): Promise<GeneratedAsset | undefined> => readMetadata(assetId),

    listProject: async (projectId: string): Promise<GeneratedAsset[]> => listAll()
      .filter((asset) => asset.projectId === projectId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),

    resolveLocalPath: (assetId: string): string => {
      const asset = readMetadata(assetId);
      if (!asset) throw new Error('Generated asset not found.');
      const path = objectPath(asset.contentSha256);
      if (!existsSync(path)) throw new Error('Generated asset bytes are missing.');
      return path;
    },

    commitVerifiedTemp: async (input: CommitVerifiedTempInput, now = new Date()): Promise<{asset: GeneratedAsset; created: boolean}> => {
      if (!input.projectId || !REQUEST_KEY.test(input.requestKey) || !CONTENT_HASH.test(input.contentSha256)) throw new Error('Invalid generated asset identity.');
      if (!Number.isSafeInteger(input.byteLength) || input.byteLength < 1) throw new Error('Invalid generated asset byte length.');
      const media = managedMediaMetadataSchema.parse(input.media);
      const tempPath = assertOwnedTemp(input.tempPath);
      const actualStats = statSync(tempPath);
      if (actualStats.size !== input.byteLength) {
        rmSync(tempPath, {force: true});
        throw new Error('Generated asset byte length does not match verified metadata.');
      }
      const actualHash = await sha256File(tempPath);
      if (actualHash !== input.contentSha256) {
        rmSync(tempPath, {force: true});
        throw new Error('Generated asset SHA-256 does not match verified bytes.');
      }

      const id = generatedAssetId(input.projectId, input.requestKey, input.contentSha256);
      const existing = readMetadata(id);
      if (existing) {
        rmSync(tempPath, {force: true});
        const comparable = {...existing, createdAt: undefined};
        const expected = {
          version: 1,
          id,
          state: 'ready',
          assetKind: input.assetKind ?? 'generated-video',
          projectId: input.projectId,
          requestKey: input.requestKey,
          ...(input.providerJobId ? {providerJobId: input.providerJobId} : {}),
          contentSha256: input.contentSha256,
          byteLength: input.byteLength,
          mimeType: input.mimeType,
          media,
          objectRelativePath: `objects/${input.contentSha256}.bin`,
          createdAt: undefined,
        };
        if (stableStringify(comparable) !== stableStringify(expected)) throw new Error('Generated asset id already exists with different metadata.');
        return {asset: existing, created: false};
      }

      const assets = listAll();
      const projectBytes = assets.filter((asset) => asset.projectId === input.projectId).reduce((sum, asset) => sum + asset.byteLength, 0);
      if (projectBytes + input.byteLength > maxProjectBytes) {
        rmSync(tempPath, {force: true});
        throw new Error('Generated asset project quota exceeded.');
      }
      const destination = objectPath(input.contentSha256);
      const objectAlreadyExists = existsSync(destination);
      const totalObjectBytes = readdirSync(objectsDirectory, {withFileTypes: true})
        .filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.bin$/.test(entry.name))
        .reduce((sum, entry) => sum + statSync(join(objectsDirectory, entry.name)).size, 0);
      if (!objectAlreadyExists && totalObjectBytes + input.byteLength > maxTotalBytes) {
        rmSync(tempPath, {force: true});
        throw new Error('Generated asset total quota exceeded.');
      }
      if (!objectAlreadyExists && getFreeBytes() - input.byteLength < minFreeBytes) {
        rmSync(tempPath, {force: true});
        throw new Error('Generated asset store free disk threshold would be violated.');
      }

      if (!objectAlreadyExists) {
        try {
          linkSync(tempPath, destination);
          fsyncDirectory(objectsDirectory);
        } catch (error) {
          if (!isCode(error, 'EEXIST')) throw error;
        }
      }
      rmSync(tempPath, {force: true});
      const asset = generatedAssetSchema.parse({
        version: 1,
        id,
        state: 'ready',
        assetKind: input.assetKind ?? 'generated-video',
        projectId: input.projectId,
        requestKey: input.requestKey,
        ...(input.providerJobId ? {providerJobId: input.providerJobId} : {}),
        contentSha256: input.contentSha256,
        byteLength: input.byteLength,
        mimeType: input.mimeType,
        media,
        objectRelativePath: `objects/${input.contentSha256}.bin`,
        createdAt: now.toISOString(),
      });
      if (!writeExclusiveJson(metadataPath(id), asset)) {
        const raced = readMetadata(id);
        if (!raced || stableStringify({...raced, createdAt: undefined}) !== stableStringify({...asset, createdAt: undefined})) {
          throw new Error('Concurrent generated asset metadata conflict.');
        }
        return {asset: raced, created: false};
      }
      return {asset, created: true};
    },

    reconcile: async ({apply, now = new Date()}: {apply: boolean; now?: Date}) => {
      const assets: GeneratedAsset[] = [];
      const corruptMetadata: string[] = [];
      for (const entry of readdirSync(metadataDirectory, {withFileTypes: true})) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        try {
          const asset = generatedAssetSchema.parse(JSON.parse(readFileSync(join(metadataDirectory, entry.name), 'utf8')));
          assets.push(asset);
        } catch {
          corruptMetadata.push(join(metadataDirectory, entry.name));
        }
      }
      const referenced = new Set(assets.map((asset) => basename(asset.objectRelativePath)));
      const missingObjects = assets
        .filter((asset) => !existsSync(objectPath(asset.contentSha256)))
        .map((asset) => asset.id);
      const orphanObjects = readdirSync(objectsDirectory, {withFileTypes: true})
        .filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.bin$/.test(entry.name) && !referenced.has(entry.name))
        .map((entry) => join(objectsDirectory, entry.name));
      const staleTemp = readdirSync(tempDirectory, {withFileTypes: true})
        .filter((entry) => entry.isFile())
        .map((entry) => join(tempDirectory, entry.name))
        .filter((path) => now.getTime() - statSync(path).mtimeMs > tempRetentionMs);
      const deleted: string[] = [];
      if (apply) {
        for (const path of [...orphanObjects, ...staleTemp]) {
          rmSync(path, {force: true});
          deleted.push(path);
        }
      }
      return {missingObjects, orphanObjects, staleTemp, corruptMetadata, deleted};
    },
  };
};

export type LocalGeneratedAssetStore = ReturnType<typeof createLocalGeneratedAssetStore>;
