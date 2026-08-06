import 'server-only';
import https from 'node:https';
import path from 'node:path';
import {createWriteStream} from 'node:fs';
import {mkdir, rm} from 'node:fs/promises';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import type {ProjectState} from '@/app/types';
import {resolveSafeRemoteUrl} from '@/app/lib/security/remote-url.server';

const MAX_ASSET_BYTES = 1024 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_REDIRECTS = 5;

const downloadPinned = async (rawUrl: string, destination: string, maxBytes: number, redirects = 0): Promise<number> => {
  if (redirects > MAX_REDIRECTS) throw new Error('Remote media exceeded the redirect limit.');
  const {url, address, family} = await resolveSafeRemoteUrl(rawUrl);
  return new Promise<number>((resolve, reject) => {
    const request = https.request({
      protocol: 'https:',
      hostname: url.hostname,
      servername: url.hostname,
      port: url.port ? Number(url.port) : 443,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {'user-agent': 'clip-js-remotion/1.0', accept: 'video/*,audio/*,image/*,application/octet-stream'},
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
          resolve(await downloadPinned(nextUrl, destination, maxBytes, redirects + 1));
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          throw new Error(`Remote media download failed with HTTP ${status}.`);
        }
        const declared = Number(response.headers['content-length'] ?? 0);
        if (declared > maxBytes) {
          response.resume();
          throw new Error('Remote media exceeds the 1GB asset limit.');
        }
        let received = 0;
        const limiter = new Transform({
          transform(chunk: Buffer, _encoding, done) {
            received += chunk.length;
            done(received > maxBytes ? new Error('Remote media exceeds the staging byte limit.') : null, chunk);
          },
        });
        await pipeline(response, limiter, createWriteStream(destination, {flags: 'wx'}));
        resolve(received);
      } catch (error) {
        reject(error);
      }
    });
    request.setTimeout(120_000, () => request.destroy(new Error('Remote media download timed out.')));
    request.on('error', reject);
    request.end();
  });
};

const extensionFor = (type: string): string => type === 'audio' ? 'mp3' : type === 'image' ? 'png' : 'mp4';

export const stageRemoteMedia = async (project: ProjectState, serveUrl: string, renderId: string): Promise<{project: ProjectState; cleanup: () => Promise<void>}> => {
  const directory = path.join(serveUrl, 'public', 'render-media', renderId);
  await mkdir(directory, {recursive: true});
  const staged = structuredClone(project);
  let totalBytes = 0;
  try {
    for (let index = 0; index < staged.mediaFiles.length; index += 1) {
      const media = staged.mediaFiles[index];
      if (!media.remoteUrl) throw new Error(`Media ${media.id} has no renderable remote URL.`);
      const filename = `asset-${index}.${extensionFor(media.type)}`;
      const remaining = MAX_TOTAL_BYTES - totalBytes;
      if (remaining <= 0) throw new Error('Remote media exceeds the 4GB total staging limit.');
      totalBytes += await downloadPinned(media.remoteUrl, path.join(directory, filename), Math.min(MAX_ASSET_BYTES, remaining));
      const localUrl = `/render-media/${renderId}/${filename}`;
      media.remoteUrl = localUrl;
      media.src = localUrl;
    }
    return {project: staged, cleanup: () => rm(directory, {recursive: true, force: true})};
  } catch (error) {
    await rm(directory, {recursive: true, force: true});
    throw error;
  }
};
