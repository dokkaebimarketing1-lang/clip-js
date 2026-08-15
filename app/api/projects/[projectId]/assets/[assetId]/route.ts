import {NextRequest, NextResponse} from 'next/server';
import {createReadStream, statSync} from 'node:fs';
import {Readable} from 'node:stream';
import {getGeneratedAssetStore} from '@/app/lib/generation/runtime.server';
import {verifyAssetCapability} from '@/app/lib/assets/asset-capability.server';
import {getCharacterImageBlobAsset, readCharacterImageBlob} from '@/app/lib/assets/character-image-blob-store.server';

const parseRange = (header: string | null, size: number): {start: number; end: number} | undefined => {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) throw new Error('Invalid Range header.');
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix < 1) throw new Error('Invalid Range header.');
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) throw new Error('Invalid Range header.');
  return {start, end: Math.min(end, size - 1)};
};

const serve = async (request: NextRequest, context: {params: Promise<{projectId: string; assetId: string}>}, head: boolean) => {
  try {
    const {projectId, assetId} = await context.params;
    verifyAssetCapability(projectId, assetId, request.nextUrl.searchParams.get('token') ?? '');
    const blobAsset = await getCharacterImageBlobAsset(assetId);
    if (blobAsset) {
      if (blobAsset.projectId !== projectId) return new NextResponse(null, {status: 404});
      const blob = await readCharacterImageBlob(blobAsset);
      const headers = new Headers({
        'content-length': String(blob.blob.size),
        'content-type': blobAsset.mimeType,
        'cache-control': 'private, no-store',
        etag: `"${blobAsset.contentSha256}"`,
      });
      return new NextResponse(head ? null : blob.stream, {status: 200, headers});
    }
    const store = getGeneratedAssetStore();
    const asset = await store.get(assetId);
    if (!asset || asset.projectId !== projectId) return new NextResponse(null, {status: 404});
    const path = store.resolveLocalPath(assetId);
    const size = statSync(path).size;
    let range: {start: number; end: number} | undefined;
    try { range = parseRange(request.headers.get('range'), size); } catch {
      return new NextResponse(null, {status: 416, headers: {'content-range': `bytes */${size}`}});
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? size - 1;
    const headers = new Headers({
      'accept-ranges': 'bytes',
      'content-length': String(end - start + 1),
      'content-type': asset.mimeType,
      'cache-control': 'private, no-store',
      etag: `"${asset.contentSha256}"`,
    });
    if (range) headers.set('content-range', `bytes ${start}-${end}/${size}`);
    if (head) return new NextResponse(null, {status: range ? 206 : 200, headers});
    const nodeStream = createReadStream(path, {start, end});
    const body = Readable.toWeb(nodeStream) as unknown as ReadableStream;
    return new NextResponse(body, {status: range ? 206 : 200, headers});
  } catch {
    return new NextResponse(null, {status: 403});
  }
};

export const GET = (request: NextRequest, context: {params: Promise<{projectId: string; assetId: string}>}) => serve(request, context, false);
export const HEAD = (request: NextRequest, context: {params: Promise<{projectId: string; assetId: string}>}) => serve(request, context, true);
