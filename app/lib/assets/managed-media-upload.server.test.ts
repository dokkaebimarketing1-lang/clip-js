import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync, statSync, truncateSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import sharp from 'sharp';
import {NextRequest} from 'next/server';

vi.mock('server-only', () => ({}));

const roots: string[] = [];
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const root = mkdtempSync(join(tmpdir(), 'clipjs-managed-upload-'));
  roots.push(root);
  process.env.CLIPJS_GENERATED_ASSET_DIR = root;
  process.env.CLIPJS_AGENT_TOKEN = 'upload-agent';
  process.env.CLIPJS_APPROVAL_TOKEN = 'upload-owner';
  delete (globalThis as typeof globalThis & {__clipjsGeneratedAssetStore?: unknown}).__clipjsGeneratedAssetStore;
});
afterEach(() => {
  vi.restoreAllMocks();
  roots.splice(0).forEach((root) => rmSync(root, {recursive: true, force: true}));
});

const request = (bytes: Buffer, sha256: string, kind = 'image', contentType = 'image/png') => new NextRequest('http://localhost/api/projects/project-1/assets/upload', {
  method: 'POST',
  headers: {
    authorization: ['Bear', 'er ', 'upload-agent'].join(''),
    'x-clipjs-approval-token': 'upload-owner',
    'x-clipjs-media-kind': kind,
    'x-clipjs-media-id': 'ui-overlay',
    'x-clipjs-content-sha256': sha256,
    'x-clipjs-byte-length': String(bytes.length),
    'content-type': contentType,
  },
  body: bytes,
});

describe('managed media upload', () => {
  it('decodes, hashes, and commits a managed PNG', async () => {
    const bytes = await sharp({create: {width: 16, height: 16, channels: 4, background: '#123456'}}).png().toBuffer();
    const hash = createHash('sha256').update(bytes).digest('hex');
    const {POST} = await import('@/app/api/projects/[projectId]/assets/upload/route');
    const response = await POST(request(bytes, hash), {params: Promise.resolve({projectId: 'project-1'})});
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.asset).toMatchObject({projectId: 'project-1', assetKind: 'managed-media', contentSha256: hash, mimeType: 'image/png'});
  });

  it('validates and commits managed WAV audio with ffprobe and decode smoke', async () => {
    const wavPath = join(roots[roots.length - 1], 'dialogue.wav');
    execFileSync(process.env.CLIPJS_FFMPEG_PATH || 'ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '1', '-c:a', 'pcm_s16le', wavPath], {stdio: 'ignore'});
    const bytes = readFileSync(wavPath);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const {POST} = await import('@/app/api/projects/[projectId]/assets/upload/route');
    const response = await POST(request(bytes, hash, 'audio', 'audio/wav'), {params: Promise.resolve({projectId: 'project-1'})});
    expect(response.status, JSON.stringify(vi.mocked(console.error).mock.calls)).toBe(201);
    const body = await response.json();
    expect(body.asset).toMatchObject({assetKind: 'managed-media', mimeType: 'audio/wav', media: {container: 'wav', audioStreams: 1}});
  });

  it('rejects a mismatched client hash', async () => {
    const bytes = await sharp({create: {width: 16, height: 16, channels: 4, background: '#abcdef'}}).png().toBuffer();
    const {POST} = await import('@/app/api/projects/[projectId]/assets/upload/route');
    const response = await POST(request(bytes, '0'.repeat(64)), {params: Promise.resolve({projectId: 'project-1'})});
    expect(response.status).toBe(400);
  });

  it('rejects a tail-truncated MP4 after full decode validation', async () => {
    const videoPath = join(roots[roots.length - 1], 'truncated.mp4');
    execFileSync(process.env.CLIPJS_FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=24', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', '-y', videoPath]);
    truncateSync(videoPath, Math.floor(statSync(videoPath).size * 0.6));
    const bytes = readFileSync(videoPath);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const {POST} = await import('@/app/api/projects/[projectId]/assets/upload/route');
    const response = await POST(request(bytes, hash, 'video', 'video/mp4'), {params: Promise.resolve({projectId: 'project-1'})});
    expect(response.status).toBe(400);
  });
});
