import {createHash} from 'node:crypto';
import {closeSync, fsyncSync, openSync, rmSync, writeSync} from 'node:fs';
import {NextRequest, NextResponse} from 'next/server';
import sharp from 'sharp';
import {authorizeAgentRequest, authorizeApprovalRequest} from '@/app/lib/security/api-auth';
import {getGeneratedAssetStore} from '@/app/lib/generation/runtime.server';
import {detectRemoteMediaFormat, type RemoteMediaKind} from '@/app/lib/render/remote-media-format';
import {probeAndDecodeGeneratedVideo, probeAndDecodeManagedAudio} from '@/app/lib/render/media-probe';
import {verifiedImageMetadataSchema, type ManagedMediaMetadataInput} from '@/app/lib/assets/generated-asset-schema';

export const runtime = 'nodejs';
export const maxDuration = 60;

const HEX64 = /^[a-f0-9]{64}$/;
const MEDIA_ID = /^[A-Za-z0-9_-]{1,128}$/;
const limits: Record<RemoteMediaKind, number> = {image: 20 * 1024 * 1024, audio: 100 * 1024 * 1024, video: 200 * 1024 * 1024};

const readToOwnedTemp = async (request: NextRequest, tempPath: string, maxBytes: number) => {
  if (!request.body) throw new Error('Media upload body is required.');
  const declared = Number(request.headers.get('content-length') ?? request.headers.get('x-clipjs-byte-length') ?? 0);
  if (!Number.isSafeInteger(declared) || declared < 1 || declared > maxBytes) throw new Error('Media Content-Length is missing or exceeds the byte limit.');
  const reader = request.body.getReader();
  const hash = createHash('sha256');
  const prefixParts: Buffer[] = [];
  let prefixBytes = 0;
  let bytes = 0;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(tempPath, 'wx', 0o600);
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      bytes += chunk.length;
      if (bytes > maxBytes) throw new Error('Media upload exceeds the streaming byte limit.');
      hash.update(chunk);
      writeSync(descriptor, chunk);
      if (prefixBytes < 64) {
        const slice = chunk.subarray(0, 64 - prefixBytes);
        prefixParts.push(slice);
        prefixBytes += slice.length;
      }
    }
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    if (bytes !== declared) throw new Error('Media upload byte count does not match Content-Length.');
    return {bytes, sha256: hash.digest('hex'), prefix: Buffer.concat(prefixParts)};
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
};

const inspectImage = async (path: string): Promise<ManagedMediaMetadataInput> => {
  const image = sharp(path, {limitInputPixels: 8192 * 8192, failOn: 'error'});
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height || !metadata.format || !['png', 'jpeg', 'webp'].includes(metadata.format)) {
    throw new Error('Managed image metadata is unsupported.');
  }
  await image.clone().resize({width: 1, height: 1, fit: 'inside'}).toBuffer();
  return verifiedImageMetadataSchema.parse({format: metadata.format, width: metadata.width, height: metadata.height});
};

export async function POST(request: NextRequest, context: {params: Promise<{projectId: string}>}) {
  let tempPath: string | undefined;
  try {
    authorizeAgentRequest(request);
    authorizeApprovalRequest(request);
    const {projectId} = await context.params;
    const kind = request.headers.get('x-clipjs-media-kind') as RemoteMediaKind | null;
    const mediaId = request.headers.get('x-clipjs-media-id') ?? '';
    const expectedHash = request.headers.get('x-clipjs-content-sha256') ?? '';
    if (!kind || !['video', 'audio', 'image'].includes(kind) || !MEDIA_ID.test(mediaId) || !HEX64.test(expectedHash)) {
      throw new Error('Managed media identity headers are invalid.');
    }
    const store = getGeneratedAssetStore();
    tempPath = store.createTempPath('managed-upload');
    const downloaded = await readToOwnedTemp(request, tempPath, limits[kind]);
    if (downloaded.sha256 !== expectedHash) throw new Error('Managed media SHA-256 does not match the request.');
    const detected = detectRemoteMediaFormat(kind, request.headers.get('content-type') ?? undefined, downloaded.prefix);
    const allowedMime = new Set(['video/mp4', 'video/quicktime', 'audio/mpeg', 'audio/wav', 'audio/mp4', 'image/png', 'image/jpeg', 'image/webp']);
    if (!allowedMime.has(detected.contentType)) throw new Error('Managed media format is not allowed.');
    const media = kind === 'video'
      ? await probeAndDecodeGeneratedVideo(tempPath)
      : kind === 'audio'
        ? await probeAndDecodeManagedAudio(tempPath)
        : await inspectImage(tempPath);
    const requestKey = createHash('sha256').update(JSON.stringify({projectId, mediaId, contentSha256: downloaded.sha256})).digest('hex');
    const committed = await store.commitVerifiedTemp({
      tempPath,
      projectId,
      requestKey,
      contentSha256: downloaded.sha256,
      byteLength: downloaded.bytes,
      assetKind: 'managed-media',
      mimeType: detected.contentType as 'video/mp4' | 'video/quicktime' | 'audio/mpeg' | 'audio/wav' | 'audio/mp4' | 'image/png' | 'image/jpeg' | 'image/webp',
      media,
    });
    tempPath = undefined;
    return NextResponse.json({asset: committed.asset, reused: !committed.created}, {status: 201});
  } catch (error) {
    if (tempPath) rmSync(tempPath, {force: true});
    const message = error instanceof Error ? error.message : '';
    const status = /Unauthorized|required/i.test(message) ? 401 : 400;
    console.error('Managed media upload rejected.', {name: error instanceof Error ? error.name : 'UnknownError', message});
    return NextResponse.json({error: status === 401 ? 'Unauthorized.' : 'Managed media upload was rejected.'}, {status});
  }
}
