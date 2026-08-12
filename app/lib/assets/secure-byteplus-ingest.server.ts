import {createHash} from 'node:crypto';
import {createReadStream, existsSync, rmSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {downloadPinnedRemoteMedia} from '@/app/lib/render/stage-remote-media';
import {probeAndDecodeGeneratedVideo} from '@/app/lib/render/media-probe';
import {resolveSafeRemoteUrl} from '@/app/lib/security/remote-url.server';
import type {createLocalGeneratedAssetStore} from './generated-asset-store.server';
import type {IngestGenerationResult} from '@/app/lib/generation/generation-worker.server';

const MAX_GENERATED_VIDEO_BYTES = 512 * 1024 * 1024;

type AssetStore = ReturnType<typeof createLocalGeneratedAssetStore>;

const hashFile = async (path: string): Promise<string> => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  stream.on('data', (chunk) => hash.update(chunk));
  stream.on('error', reject);
  stream.on('end', () => resolve(hash.digest('hex')));
});

const assertAuthorizedResolution = (width: number, height: number, resolution: '480p' | '720p'): void => {
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const maxLong = resolution === '720p' ? 1280 : 854;
  const maxShort = resolution === '720p' ? 720 : 480;
  if (longEdge > maxLong || shortEdge > maxShort) throw new Error('Generated video resolution exceeds the authorized request.');
};

export const createSecureBytePlusResultIngestor = (options: {
  assetStore: AssetStore;
  allowedHosts?: readonly string[];
  maxBytes?: number;
  download?: typeof downloadPinnedRemoteMedia;
}): IngestGenerationResult => async (input) => {
  const allowedHosts = options.allowedHosts ?? (process.env.BYTEPLUS_RESULT_HOSTS ?? '').split(',').map((host) => host.trim()).filter(Boolean);
  if (!allowedHosts.length) throw new Error('BYTEPLUS_RESULT_HOSTS must be configured.');
  const destinationBase = options.assetStore.createTempPath(`byteplus-${input.requestKey.slice(0, 16)}`);
  const resolveResultUrl = (url: string) => resolveSafeRemoteUrl(url, {
    allowedHosts,
    requireAllowlist: true,
    allowlistName: 'BYTEPLUS_RESULT_HOSTS',
    signal: input.signal,
    timeoutMs: 5000,
  });
  let downloadedPath: string | undefined;
  try {
    const downloaded = await (options.download ?? downloadPinnedRemoteMedia)(
      input.resultTransportUrl,
      destinationBase,
      options.maxBytes ?? MAX_GENERATED_VIDEO_BYTES,
      'video',
      input.signal,
      0,
      resolveResultUrl,
    );
    downloadedPath = join(options.assetStore.tempDirectory, downloaded.filename);
    const metadata = await probeAndDecodeGeneratedVideo(downloadedPath, input.authorizedDuration);
    assertAuthorizedResolution(metadata.width, metadata.height, input.authorizedResolution);
    if (input.authorizedGenerateAudio && metadata.audioStreams !== 1) throw new Error('Generated result is missing authorized source audio.');
    if (!input.authorizedGenerateAudio && metadata.audioStreams !== 0) throw new Error('Generated result contains unauthorized source audio.');
    const stats = statSync(downloadedPath);
    const contentSha256 = await hashFile(downloadedPath);
    const committed = await options.assetStore.commitVerifiedTemp({
      tempPath: downloadedPath,
      projectId: input.projectId,
      requestKey: input.requestKey,
      providerJobId: input.providerJobId,
      contentSha256,
      byteLength: stats.size,
      mimeType: downloaded.filename.endsWith('.mov') ? 'video/quicktime' : 'video/mp4',
      media: metadata,
    });
    return {assetId: committed.asset.id, contentSha256: committed.asset.contentSha256, actualDurationSeconds: metadata.durationSeconds};
  } catch (error) {
    if (downloadedPath && existsSync(downloadedPath)) rmSync(downloadedPath, {force: true});
    for (const suffix of ['.download', '.mp4', '.mov', '.m4v', '.webm']) {
      const partial = `${destinationBase}${suffix}`;
      if (existsSync(partial)) rmSync(partial, {force: true});
    }
    throw error;
  }
};
