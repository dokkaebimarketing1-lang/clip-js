import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';

vi.mock('server-only', () => ({}));
const submit = vi.fn();
const getJob = vi.fn();
const ingest = vi.fn();
const createCapability = vi.fn(() => 'preview-token');
vi.mock('@/app/lib/higgsfield/generate.server', () => ({
  submitHiggsfieldCharacterImageJob: submit,
  getHiggsfieldGenerationJob: getJob,
}));
vi.mock('@/app/lib/assets/secure-higgsfield-image-ingest.server', () => ({ingestHiggsfieldCharacterImage: ingest}));
vi.mock('@/app/lib/assets/asset-capability.server', () => ({createAssetCapability: createCapability}));
vi.mock('@/app/lib/generation/runtime.server', () => ({getGeneratedAssetStore: () => ({kind: 'test-store'})}));

const context = {params: Promise.resolve({projectId: 'project-1'})};
const makePost = (body: unknown, origin = 'http://localhost') => new NextRequest('http://localhost/api/projects/project-1/character-image', {
  method: 'POST',
  headers: {origin, 'sec-fetch-site': origin === 'http://localhost' ? 'same-origin' : 'cross-site', 'content-type': 'application/json'},
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('CLIPJS_HIGGSFIELD_TEMP_SUBMIT_ENABLED', 'true');
  submit.mockResolvedValue({id: '4e97908e-4b6d-413a-96e8-d64c560267bc'});
  getJob.mockResolvedValue({id: '4e97908e-4b6d-413a-96e8-d64c560267bc', status: 'completed', job_type: 'nano_banana_2_lite', result_url: 'https://d8j0ntlcm91z4.cloudfront.net/result.png'});
  ingest.mockResolvedValue({assetId: 'ga_0123456789abcdef0123456789abcdef', contentSha256: 'a'.repeat(64)});
});

describe('project character image generation route', () => {
  it('requires explicit approval of exactly one credit', async () => {
    const {POST} = await import('./route');
    const response = await POST(makePost({prompt: 'a valid character reference prompt', confirmCreditCost: 0}), context);
    expect(response.status).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });

  it('submits the fixed low-cost image specification', async () => {
    const {POST} = await import('./route');
    const response = await POST(makePost({prompt: 'a valid character reference prompt', confirmCreditCost: 1}), context);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({jobId: '4e97908e-4b6d-413a-96e8-d64c560267bc', status: 'queued', model: 'nano_banana_2_lite', credits: 1, reused: false});
    expect(submit).toHaveBeenCalledWith({prompt: 'a valid character reference prompt', aspect_ratio: '16:9', resolution: '1k', thinking: 'HIGH'});
  });

  it('reuses the active project job instead of double charging', async () => {
    const {POST} = await import('./route');
    const first = await POST(makePost({prompt: 'a valid character reference prompt', confirmCreditCost: 1}), context);
    const second = await POST(makePost({prompt: 'a valid character reference prompt', confirmCreditCost: 1}), context);
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(await second.json()).toMatchObject({jobId: '4e97908e-4b6d-413a-96e8-d64c560267bc', reused: true});
    expect(submit).toHaveBeenCalledOnce();
  });

  it('rejects cross-site paid submissions', async () => {
    const {POST} = await import('./route');
    const response = await POST(makePost({prompt: 'a valid character reference prompt', confirmCreditCost: 1}, 'https://evil.example'), context);
    expect(response.status).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });

  it('ingests a completed expected-model result and returns a capability URL', async () => {
    const {GET, POST} = await import('./route');
    await POST(makePost({prompt: 'a valid character reference prompt', confirmCreditCost: 1}), context);
    const response = await GET(new NextRequest('http://localhost/api/projects/project-1/character-image?jobId=4e97908e-4b6d-413a-96e8-d64c560267bc', {headers: {origin: 'http://localhost', 'sec-fetch-site': 'same-origin'}}), context);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({status: 'completed', assetId: 'ga_0123456789abcdef0123456789abcdef', contentSha256: 'a'.repeat(64)});
    expect(payload.previewUrl).toContain('token=preview-token');
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({projectId: 'project-1', jobId: '4e97908e-4b6d-413a-96e8-d64c560267bc'}));
  });

  it('rejects a completed result from another model', async () => {
    getJob.mockResolvedValueOnce({id: '4e97908e-4b6d-413a-96e8-d64c560267bc', status: 'completed', job_type: 'seedance_2_5', result_url: 'https://d8j0ntlcm91z4.cloudfront.net/result.png'});
    const {GET, POST} = await import('./route');
    await POST(makePost({prompt: 'a valid character reference prompt', confirmCreditCost: 1}), context);
    const response = await GET(new NextRequest('http://localhost/api/projects/project-1/character-image?jobId=4e97908e-4b6d-413a-96e8-d64c560267bc', {headers: {'sec-fetch-site': 'same-origin'}}), context);
    expect(response.status).toBe(400);
    expect(ingest).not.toHaveBeenCalled();
  });
});
