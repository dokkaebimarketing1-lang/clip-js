import {NextRequest} from 'next/server';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {storyboardSchema} from '@/app/lib/workflow/schema';

vi.mock('server-only', () => ({}));

const storyboard = storyboardSchema.parse({
  version: 'storyboard-v2',
  title: '검수할 스토리보드',
  noBgm: true,
  styleBibleHash: 'a'.repeat(64),
  characterReferenceIds: ['asset-1'],
  cuts: [{
    id: 'CUT01', title: '첫 장면', absoluteStartSeconds: 0, absoluteEndSeconds: 4,
    characterIds: ['CHAR01'],
    shots: [{id: 'S1', startSeconds: 0, endSeconds: 4, startFrame: '시작', endFrame: '끝', camera: '고정', action: '인사한다', dialogue: '안녕', sfx: '바람'}],
  }],
});
const characterSheets = [{id: 'CHAR01', name: '초코', visualTags: ['강아지'], referenceImageId: 'asset-1', referenceStyleHash: 'a'.repeat(64), styleReferenceImageIds: []}];

const request = (origin = 'http://localhost') => new NextRequest('http://localhost/api/projects/project-1/creative-approval/ui', {
  method: 'POST',
  headers: {'content-type': 'application/json', origin, 'sec-fetch-site': origin === 'http://localhost' ? 'same-origin' : 'cross-site'},
  body: JSON.stringify({storyboard, characterSheets}),
});

describe('same-origin creative approval UI', () => {
  beforeEach(() => {
    process.env.CLIPJS_APPROVAL_SIGNING_SECRET = 'approval-signing-secret-approval-signing-secret';
    process.env.CLIPJS_APPROVAL_SIGNING_KEY_ID = 'test-key';
  });
  afterEach(() => {
    delete process.env.CLIPJS_APPROVAL_SIGNING_SECRET;
    delete process.env.CLIPJS_APPROVAL_SIGNING_KEY_ID;
  });

  it('서버 비밀을 브라우저에 노출하지 않고 현재 스토리보드를 서명한다', async () => {
    const {POST} = await import('./route');
    const response = await POST(request(), {params: Promise.resolve({projectId: 'project-1'})});
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.creativeApproval).toMatchObject({status: 'approved', approvedBy: 'project-owner', signingKeyId: 'test-key'});
    expect(body.creativeApproval.signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it('교차 사이트 승인 요청을 거부한다', async () => {
    const {POST} = await import('./route');
    const response = await POST(request('https://evil.example'), {params: Promise.resolve({projectId: 'project-1'})});
    expect(response.status).toBe(403);
  });
});
