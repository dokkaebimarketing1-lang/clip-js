import {createHash} from 'node:crypto';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import sharp from 'sharp';
import {NextRequest} from 'next/server';

vi.mock('server-only', () => ({}));

const roots: string[] = [];
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const root = mkdtempSync(join(tmpdir(), 'clipjs-ui-upload-'));
  roots.push(root);
  process.env.CLIPJS_GENERATED_ASSET_DIR = root;
  process.env.CLIPJS_AGENT_TOKEN = 'server-agent';
  process.env.CLIPJS_APPROVAL_TOKEN = 'server-owner';
  process.env.CLIPJS_ASSET_CAPABILITY_SECRET = 'capability-secret-capability-secret';
  delete (globalThis as typeof globalThis & {__clipjsGeneratedAssetStore?: unknown}).__clipjsGeneratedAssetStore;
});
afterEach(() => {
  vi.restoreAllMocks();
  roots.splice(0).forEach((root) => rmSync(root, {recursive: true, force: true}));
});

const makeRequest = (bytes: Buffer, origin = 'http://localhost') => new NextRequest('http://localhost/api/projects/project-1/assets/ui-upload', {
  method: 'POST',
  headers: {
    origin,
    'sec-fetch-site': origin === 'http://localhost' ? 'same-origin' : 'cross-site',
    'content-type': 'image/png',
    'content-length': String(bytes.length),
  },
  body: bytes,
});

describe('same-origin project UI upload', () => {
  it('uses server-only credentials and returns an expiring preview capability', async () => {
    const bytes = await sharp({create: {width: 20, height: 20, channels: 4, background: '#223344'}}).png().toBuffer();
    const {POST} = await import('./route');
    const response = await POST(makeRequest(bytes), {params: Promise.resolve({projectId: 'project-1'})});
    expect(response.status, JSON.stringify(vi.mocked(console.error).mock.calls)).toBe(201);
    const payload = await response.json();
    expect(payload).toMatchObject({contentSha256: createHash('sha256').update(bytes).digest('hex')});
    expect(payload.assetId).toMatch(/^ga_[a-f0-9]{32}$/);
    expect(payload.previewUrl).toContain(`/assets/${payload.assetId}?token=`);
  });

  it('rejects cross-site uploads before touching the managed store', async () => {
    const bytes = await sharp({create: {width: 20, height: 20, channels: 4, background: '#223344'}}).png().toBuffer();
    const {POST} = await import('./route');
    const response = await POST(makeRequest(bytes, 'https://evil.example'), {params: Promise.resolve({projectId: 'project-1'})});
    expect(response.status).toBe(400);
  });
});
