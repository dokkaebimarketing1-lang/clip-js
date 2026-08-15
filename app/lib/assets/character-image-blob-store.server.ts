import {createHash} from 'node:crypto';
import {get, put, type GetBlobResult} from '@vercel/blob';
import sharp from 'sharp';
import {generatedAssetSchema, type GeneratedAsset} from './generated-asset-schema';
import {createServerRedis} from '@/app/lib/storage/redis.server';

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const metadataKey = (assetId: string) => `clipjs:blob-assets:v1:asset:${assetId}`;
const projectKey = (projectId: string) => `clipjs:blob-assets:v1:project:${createHash('sha256').update(projectId).digest('hex')}`;
const blobPath = (contentSha256: string) => `character-images/${contentSha256}.bin`;
const redis = () => createServerRedis({automaticDeserialization: false});
const parseAsset = (value: unknown): GeneratedAsset | undefined => {
  if (value === null || value === undefined) return undefined;
  return generatedAssetSchema.parse(typeof value === 'string' ? JSON.parse(value) : value);
};

export const getCharacterImageBlobAsset = async (assetId: string): Promise<GeneratedAsset | undefined> =>
  parseAsset(await redis().get(metadataKey(assetId)));

export const listCharacterImageBlobAssets = async (projectId: string): Promise<GeneratedAsset[]> => {
  const ids = await redis().smembers(projectKey(projectId));
  return (await Promise.all(ids.map((id) => getCharacterImageBlobAsset(String(id))))).filter((asset): asset is GeneratedAsset => Boolean(asset));
};

export const ingestCharacterImageBlob = async (input: {
  projectId: string;
  requestKey: string;
  providerJobId: string;
  bytes: Uint8Array;
  styleLineage: {styleBibleHash: string; styleReferenceImageIds: string[]};
}): Promise<GeneratedAsset> => {
  if (input.bytes.byteLength < 128 || input.bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('Generated image size is invalid.');
  const contentSha256 = createHash('sha256').update(input.bytes).digest('hex');
  const image = await sharp(input.bytes, {failOn: 'error', limitInputPixels: 8192 * 8192}).metadata();
  if (!image.width || !image.height || !image.format || !['png', 'jpeg', 'webp'].includes(image.format)) throw new Error('Generated image format is not allowed.');
  const mimeType = image.format === 'png' ? 'image/png' : image.format === 'jpeg' ? 'image/jpeg' : 'image/webp';
  const id = `ga_${createHash('sha256').update(`${input.projectId}:${input.requestKey}:${contentSha256}`).digest('hex').slice(0, 32)}`;
  const asset = generatedAssetSchema.parse({
    version: 1,
    id,
    state: 'ready',
    assetKind: 'managed-media',
    projectId: input.projectId,
    requestKey: input.requestKey,
    providerJobId: input.providerJobId,
    styleLineage: input.styleLineage,
    contentSha256,
    byteLength: input.bytes.byteLength,
    mimeType,
    media: {format: image.format, width: image.width, height: image.height},
    objectRelativePath: `objects/${contentSha256}.bin`,
    createdAt: new Date().toISOString(),
  });
  await put(blobPath(contentSha256), input.bytes, {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: mimeType,
    cacheControlMaxAge: 31_536_000,
  });
  const client = redis();
  await client.set(metadataKey(id), JSON.stringify(asset));
  await client.sadd(projectKey(input.projectId), id);
  return asset;
};

export const readCharacterImageBlob = async (asset: GeneratedAsset): Promise<GetBlobResult> => {
  const result = await get(blobPath(asset.contentSha256), {access: 'private'});
  if (!result || result.statusCode !== 200) throw new Error('Character image blob is unavailable.');
  return result;
};
