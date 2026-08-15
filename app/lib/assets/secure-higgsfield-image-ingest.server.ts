import 'server-only';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, rmSync, statSync} from 'node:fs';
import {join} from 'node:path';
import sharp from 'sharp';
import {downloadPinnedRemoteMedia} from '@/app/lib/render/stage-remote-media';
import {resolveSafeRemoteUrl} from '@/app/lib/security/remote-url.server';
import type {createLocalGeneratedAssetStore} from './generated-asset-store.server';
import type {GeneratedAsset} from './generated-asset-schema';
import {HIGGSFIELD_IMAGE_MAX_BYTES, HIGGSFIELD_IMAGE_RESULT_HOSTS} from '@/app/lib/higgsfield/result-policy';

type AssetStore = ReturnType<typeof createLocalGeneratedAssetStore>;

export const ingestHiggsfieldCharacterImage = async (input: {
  projectId: string;
  jobId: string;
  resultUrl: string;
  assetStore: AssetStore;
  styleLineage: NonNullable<GeneratedAsset['styleLineage']>;
  allowedHosts?: readonly string[];
}) => {
  const requestKey = createHash('sha256').update(`higgsfield-character:${input.projectId}:${input.jobId}`).digest('hex');
  const destinationBase = input.assetStore.createTempPath(`higgsfield-image-${input.jobId.slice(0, 8)}`);
  const resolveResultUrl = (url: string) => resolveSafeRemoteUrl(url, {
    allowedHosts: input.allowedHosts ?? HIGGSFIELD_IMAGE_RESULT_HOSTS,
    requireAllowlist: true,
    allowlistName: 'HIGGSFIELD_IMAGE_RESULT_HOSTS',
    timeoutMs: 5000,
  });
  let downloadedPath: string | undefined;
  try {
    const downloaded = await downloadPinnedRemoteMedia(input.resultUrl, destinationBase, HIGGSFIELD_IMAGE_MAX_BYTES, 'image', undefined, 0, resolveResultUrl);
    downloadedPath = join(input.assetStore.tempDirectory, downloaded.filename);
    const metadata = await sharp(downloadedPath, {failOn: 'error'}).metadata();
    const format = metadata.format;
    if (format !== 'png' && format !== 'jpeg' && format !== 'webp') throw new Error('Higgsfield image format is not allowed.');
    if (!metadata.width || !metadata.height || metadata.width < 16 || metadata.height < 16 || metadata.width > 8192 || metadata.height > 8192) {
      throw new Error('Higgsfield image dimensions are outside the allowed bounds.');
    }
    await sharp(downloadedPath, {failOn: 'error'}).raw().toBuffer({resolveWithObject: true});
    const bytes = statSync(/* turbopackIgnore: true */ downloadedPath).size;
    const contentSha256 = createHash('sha256').update(readFileSync(/* turbopackIgnore: true */ downloadedPath)).digest('hex');
    const mimeType = format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp';
    const committed = await input.assetStore.commitVerifiedTemp({
      tempPath: downloadedPath,
      projectId: input.projectId,
      requestKey,
      providerJobId: input.jobId,
      styleLineage: input.styleLineage,
      contentSha256,
      byteLength: bytes,
      assetKind: 'managed-media',
      mimeType,
      media: {format, width: metadata.width, height: metadata.height},
    });
    downloadedPath = undefined;
    return {assetId: committed.asset.id, contentSha256: committed.asset.contentSha256};
  } finally {
    if (downloadedPath && existsSync(/* turbopackIgnore: true */ downloadedPath)) rmSync(/* turbopackIgnore: true */ downloadedPath, {force: true});
    for (const suffix of ['.download', '.png', '.jpg', '.jpeg', '.webp']) {
      const partial = `${destinationBase}${suffix}`;
      if (existsSync(/* turbopackIgnore: true */ partial)) rmSync(/* turbopackIgnore: true */ partial, {force: true});
    }
  }
};
