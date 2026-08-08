import 'server-only';
import https from 'node:https';
import path from 'node:path';
import {createWriteStream} from 'node:fs';
import {mkdir, rename, rm} from 'node:fs/promises';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import type {ProjectState} from '@/app/types';
import {resolveSafeRemoteUrl} from '@/app/lib/security/remote-url.server';
import {detectRemoteMediaFormat, type RemoteMediaKind} from './remote-media-format';
import {verifyStagedMediaStreams} from './media-probe';

const MAX_ASSET_BYTES = 128 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const SIGNATURE_BYTES = 32;

type StagedDownload = {bytes: number; filename: string};

const isRemoteMediaKind = (value: string): value is RemoteMediaKind =>
  value === 'video' || value === 'audio' || value === 'image';

const downloadPinned = async (
  rawUrl: string,
  destinationBase: string,
  maxBytes: number,
  kind: RemoteMediaKind,
  signal?: AbortSignal,
  redirects = 0,
): Promise<StagedDownload> => {
  if (redirects > MAX_REDIRECTS) throw new Error('Remote media exceeded the redirect limit.');
  signal?.throwIfAborted();
  const {url, address, family} = await resolveSafeRemoteUrl(rawUrl);
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
          resolve(await downloadPinned(nextUrl, destinationBase, maxBytes, kind, signal, redirects + 1));
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          throw new Error(`Remote media download failed with HTTP ${status}.`);
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
      if (!media.remoteUrl) throw new Error(`Media ${media.id} has no renderable remote URL.`);
      if (!isRemoteMediaKind(media.type)) throw new Error(`Media ${media.id} has an unsupported render type.`);
      const remaining = MAX_TOTAL_BYTES - totalBytes;
      if (remaining <= 0) throw new Error('Remote media exceeds the total staging byte limit.');
      const downloaded = await downloadPinned(
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
