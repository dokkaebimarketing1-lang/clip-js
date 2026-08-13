import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';
import {sha256} from '@/app/lib/workflow/hash';
import {styleBibleSchema} from '@/app/lib/workflow/schema';
import {POST} from './route';

const getAsset = vi.fn();
const setStyleLineage = vi.fn();
vi.mock('@/app/lib/generation/runtime.server', () => ({getGeneratedAssetStore: () => ({get: getAsset, setStyleLineage})}));

const anchorReferenceImageId = `ga_${'1'.repeat(32)}`;

const makeRequest = (body: unknown, headers: Record<string, string> = {}) => {
  const payload = JSON.stringify(body);
  return new NextRequest('http://localhost/api/vlog/style-bible', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(new TextEncoder().encode(payload).byteLength),
      origin: 'http://localhost',
      'sec-fetch-site': 'same-origin',
      ...headers,
    },
    body: payload,
  });
};

const body = {projectId: 'project-a', anchorReferenceImageId, tone: '밝고 경쾌한'};

describe('style bible route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAsset.mockResolvedValue({id: anchorReferenceImageId, projectId: 'project-a', state: 'ready', mimeType: 'image/png', contentSha256: '2'.repeat(64)});
    setStyleLineage.mockResolvedValue(undefined);
  });

  it('builds a canonical anchor-led style bible for a project-owned ready image', async () => {
    const response = await POST(makeRequest(body));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(() => styleBibleSchema.parse(payload.styleBible)).not.toThrow();
    expect(payload.styleBible.visualMedium).toMatch(/anchor image is authoritative/i);
    expect(payload.styleBible).toMatchObject({anchorReferenceImageId, anchorContentSha256: '2'.repeat(64)});
    await expect(sha256(payload.styleBible)).resolves.toBe(payload.styleBibleHash);
    expect(setStyleLineage).toHaveBeenCalledWith(anchorReferenceImageId, 'project-a', {styleBibleHash: payload.styleBibleHash, styleReferenceImageIds: []});
  });

  it('rejects an anchor owned by another project', async () => {
    getAsset.mockResolvedValue({id: anchorReferenceImageId, projectId: 'project-b', state: 'ready', mimeType: 'image/png'});
    expect((await POST(makeRequest(body))).status).toBe(409);
  });

  it('rejects cross-site and oversized requests', async () => {
    expect((await POST(makeRequest(body, {origin: 'http://evil.test', 'sec-fetch-site': 'cross-site'}))).status).toBe(400);
    expect((await POST(makeRequest(body, {'content-length': '5000'}))).status).toBe(413);
    expect((await POST(makeRequest({...body, tone: 'x'.repeat(5000)}, {'content-length': '1'}))).status).toBe(413);
  });
});
