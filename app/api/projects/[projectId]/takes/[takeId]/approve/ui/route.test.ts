import {NextRequest} from 'next/server';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/app/lib/generation/runtime.server', () => ({getGenerationRepository: vi.fn()}));

const projectId = 'project-1';
const takeId = 'take-1';
const requestKey = 'a'.repeat(64);
const assetId = 'ga_ready';
const contentSha256 = 'b'.repeat(64);

const readyRecord = {
  claim: {projectId},
  job: {status: 'ready', takeId, assetId, contentSha256},
};

const request = (origin = 'http://localhost:3000') => new NextRequest(`http://localhost:3000/api/projects/${projectId}/takes/${takeId}/approve/ui`, {
  method: 'POST',
  headers: {'content-type': 'application/json', origin},
  body: JSON.stringify({requestKey, assetId, contentSha256}),
});

describe('take approval UI route', () => {
  beforeEach(async () => {
    process.env.CLIPJS_APPROVAL_SECRET = 'test-approval-secret-that-is-long-enough';
    process.env.CLIPJS_APPROVAL_KEY_ID = 'test-key';
    const {getGenerationRepository} = await import('@/app/lib/generation/runtime.server');
    vi.mocked(getGenerationRepository).mockReturnValue({get: vi.fn().mockResolvedValue(readyRecord)} as never);
  });

  it('교차 사이트 승인을 거부한다', async () => {
    const {POST} = await import('./route');
    const response = await POST(request('https://evil.example'), {params: Promise.resolve({projectId, takeId})});
    expect(response.status).toBe(403);
  });

  it('ready generation identity가 일치할 때만 서명한다', async () => {
    const {POST} = await import('./route');
    const response = await POST(request(), {params: Promise.resolve({projectId, takeId})});
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.takeApproval).toMatchObject({status: 'approved', takeId, assetId, contentSha256, approvedBy: 'project-owner'});
    expect(body.takeApproval.signature).toMatch(/^[a-f0-9]{64}$/);
  });
});
