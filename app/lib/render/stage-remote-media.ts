import 'server-only';
import https from 'node:https';
import path from 'node:path';
import {createWriteStream} from 'node:fs';
import {copyFile, link, mkdir, rename, rm} from 'node:fs/promises';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import type {ProjectState} from '@/app/types';
import {resolveSafeRemoteUrl, type ResolvedRemoteUrl} from '@/app/lib/security/remote-url.server';
import {detectRemoteMediaFormat, type RemoteMediaKind} from './remote-media-format';
import {verifyStagedMediaStreams} from './media-probe';
import {getGeneratedAssetStore} from '@/app/lib/generation/runtime.server';

const MAX_ASSET_BYTES = 128 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const SIGNATURE_BYTES = 32;

export type StagedDownload = {bytes: number; filename: string};
type RemoteResolver = (rawUrl: string) => Promise<ResolvedRemoteUrl>;

const isRemoteMediaKind = (value: string): value is RemoteMediaKind =>
  value === 'video' || value === 'audio' || value === 'image';

export const downloadPinnedRemoteMedia = async (
  rawUrl: string,
  destinationBase: string,
  maxBytes: number,
  kind: RemoteMediaKind,
  signal?: AbortSignal,
  redirects = 0,
  resolveRemote: RemoteResolver = resolveSafeRemoteUrl,
): Promise<StagedDownload> => {
  if (redirects > MAX_REDIRECTS) throw new Error('Remote media exceeded the redirect limit.');
  signal?.throwIfAborted();
  const {url, address, family} = await resolveRemote(rawUrl);
  return new Promise<StagedDownload>((resolve, reject) => {
    const request = https.request({
      protocol: 'https:',
      hostname: url.hostname,
      servername: url.hostname,
      port: url.port ? Number(url.port) : 443,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {'user-agent': 'clip-js-remotion/1.0', accept: 'video/*,audio/*,image/*,application/octet-stream'},
      signal,
      lookup: (_hostname, options, callback) => {
        if (typeof options === 'object' && options.all) {
          const callbackAll = callback as unknown as (error: null, addresses: Array<{address: string; family: 4 | 6}>) => void;
          callbackAll(null, [{address, family}]);
          return;
        }
        callback(null, address, family);
      },
    }, async (response) => {
      try {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          const location = response.headers.location;
          response.resume();
          if (!location) throw new Error('Remote media redirect has no location.');
          const nextUrl = new URL(location, url).toString();
          resolve(await downloadPinnedRemoteMedia(nextUrl, destinationBase, maxBytes, kind, signal, redirects + 1, resolveRemote));
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          throw new Error(`Remote media download failed with HTTP ${status}.`);
        }
        const contentEncoding = String(response.headers['content-encoding'] ?? 'identity').toLowerCase();
        if (contentEncoding !== 'identity') {
          response.resume();
          throw new Error('Compressed remote media responses are not allowed.');
        }
        const declared = Number(response.headers['content-length'] ?? 0);
        if (declared > maxBytes) {
          response.resume();
          throw new Error('Remote media exceeds the per-asset byte limit.');
        }
        let received = 0;
        let prefix = Buffer.alloc(0);
        const limiter = new Transform({
          transform(chunk: Buffer, _encoding, done) {
            received += chunk.length;
            if (prefix.length < SIGNATURE_BYTES) {
              prefix = Buffer.concat([prefix, chunk.subarray(0, SIGNATURE_BYTES - prefix.length)]);
            }
            done(received > maxBytes ? new Error('Remote media exceeds the staging byte limit.') : null, chunk);
          },
        });
        const temporary = `${destinationBase}.download`;
        await pipeline(response, limiter, createWriteStream(temporary, {flags: 'wx'}), {signal});
        const format = detectRemoteMediaFormat(kind, response.headers['content-type'], prefix);
        const destination = `${destinationBase}.${format.extension}`;
        await rename(temporary, destination);
        resolve({bytes: received, filename: path.basename(destination)});
      } catch (error) {
        await rm(`${destinationBase}.download`, {force: true}).catch(() => undefined);
        reject(error);
      }
    });
    request.setTimeout(40_000, () => request.destroy(new Error('Remote media download timed out.')));
    request.on('error', reject);
    request.end();
  });
};

export const stageRemoteMedia = async (
  project: ProjectState,
  serveUrl: string,
  renderId: string,
  signal?: AbortSignal,
): Promise<{project: ProjectState; cleanup: () => Promise<void>}> => {
  const directory = path.join(serveUrl, 'public', 'render-media', renderId);
  await mkdir(directory, {recursive: true});
  const staged = structuredClone(project);
  let totalBytes = 0;
  try {
    for (let index = 0; index < staged.mediaFiles.length; index += 1) {
      signal?.throwIfAborted();
      const media = staged.mediaFiles[index];
      if (media.source?.kind === 'generated' || media.source?.kind === 'managed') {
        const store = getGeneratedAssetStore();
        const assetId = media.source.kind === 'generated' ? media.source.generatedAssetId : media.source.assetId;
        const asset = await store.get(assetId);
        const expectedKind = media.source.kind === 'generated' ? 'generated-video' : 'managed-media';
        if (!asset || asset.projectId !== project.id || asset.assetKind !== expectedKind || media.contentSha256 !== asset.contentSha256) {
          throw new Error(`Managed media ${media.id} does not match the server asset registry.`);
        }
        if (media.source.kind === 'generated' && media.generatedAssetId !== asset.id) {
          throw new Error(`Generated media ${media.id} does not match its Take asset ID.`);
        }
        if (totalBytes + asset.byteLength > MAX_TOTAL_BYTES) throw new Error('Managed media exceeds the total staging byte limit.');
        const extensions: Record<string, string> = {
          'video/mp4': 'mp4', 'video/quicktime': 'mov', 'audio/mpeg': 'mp3', 'audio/wav': 'wav',
          'audio/mp4': 'm4a', 'audio/webm': 'webm', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
        };
        const extension = extensions[asset.mimeType];
        if (!extension) throw new Error(`Managed media ${media.id} has an unsupported MIME type.`);
        const filename = `asset-${index}.${extension}`;
        const sourcePath = store.resolveLocalPath(asset.id);
        const destination = path.join(directory, filename);
        try { await link(sourcePath, destination); } catch { await copyFile(sourcePath, destination); }
        totalBytes += asset.byteLength;
        const localUrl = `/render-media/${renderId}/${filename}`;
        media.remoteUrl = localUrl;
        media.src = localUrl;
        continue;
      }
      if (!media.remoteUrl) throw new Error(`Media ${media.id} has no renderable remote URL.`);
      if (!isRemoteMediaKind(media.type)) throw new Error(`Media ${media.id} has an unsupported render type.`);
      const remaining = MAX_TOTAL_BYTES - totalBytes;
      if (remaining <= 0) throw new Error('Remote media exceeds the total staging byte limit.');
      const downloaded = await downloadPinnedRemoteMedia(
        media.remoteUrl,
        path.join(directory, `asset-${index}`),
        Math.min(MAX_ASSET_BYTES, remaining),
        media.type,
        signal,
      );
      await verifyStagedMediaStreams(path.join(directory, downloaded.filename), media.type);
      totalBytes += downloaded.bytes;
      const localUrl = `/render-media/${renderId}/${downloaded.filename}`;
      media.remoteUrl = localUrl;
      media.src = localUrl;
    }
    return {project: staged, cleanup: () => rm(directory, {recursive: true, force: true})};
  } catch (error) {
    await rm(directory, {recursive: true, force: true});
    throw error;
  }
};
