import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {extname, join} from 'node:path';
import {tmpdir} from 'node:os';

vi.mock('server-only', () => ({}));
const submit = vi.fn();
const getJob = vi.fn();
const ingest = vi.fn();
const createCapability = vi.fn(() => 'preview-token');
const getAsset = vi.fn();
const listProject = vi.fn();
const resolveLocalPath = vi.fn((id: string) => `C:\\clipjs\\${id}.bin`);
const styleBibleHash = 'a'.repeat(64);
vi.mock('@/app/lib/higgsfield/generate.server', () => ({
  submitHiggsfieldCharacterImageJob: submit,
  getHiggsfieldGenerationJob: getJob,
  parseHiggsfieldSubmittedJobId: (value: unknown) => Array.isArray(value) ? value[0] : (value as {id?: string})?.id,
}));
vi.mock('@/app/lib/assets/secure-higgsfield-image-ingest.server', () => ({ingestHiggsfieldCharacterImage: ingest}));
vi.mock('@/app/lib/assets/asset-capability.server', () => ({createAssetCapability: createCapability}));
vi.mock('@/app/lib/generation/runtime.server', () => ({getGeneratedAssetStore: () => ({kind: 'test-store', get: getAsset, listProject, resolveLocalPath})}));

const context = {params: Promise.resolve({projectId: 'project-1'})};
const makePost = (body: unknown, origin = 'http://localhost') => new NextRequest('http://localhost/api/projects/project-1/character-image', {
  method: 'POST',
  headers: {origin, 'sec-fetch-site': origin === 'http://localhost' ? 'same-origin' : 'cross-site', 'content-type': 'application/json'},
  body: JSON.stringify({characterId: 'CHAR01', styleBibleHash, styleReferenceImageIds: [], ...(body as object)}),
});
const makeGet = (characterId = 'CHAR01') => new NextRequest(`http://localhost/api/projects/project-1/character-image?jobId=4e97908e-4b6d-413a-96e8-d64c560267bc&characterId=${characterId}`, {headers: {origin: 'http://localhost', 'sec-fetch-site': 'same-origin'}});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('CLIPJS_HIGGSFIELD_TEMP_SUBMIT_ENABLED', 'true');
  submit.mockResolvedValue(['4e97908e-4b6d-413a-96e8-d64c560267bc']);
  getJob.mockResolvedValue({id: '4e97908e-4b6d-413a-96e8-d64c560267bc', status: 'completed', job_type: 'nano_banana_2_lite', result_url: 'https://d8j0ntlcm91z4.cloudfront.net/result.png'});
  ingest.mockResolvedValue({assetId: 'ga_0123456789abcdef0123456789abcdef', contentSha256: 'a'.repeat(64)});
  getAsset.mockImplementation(async (id: string) => ({id, projectId: 'project-1', state: 'ready', mimeType: 'image/png'}));
  listProject.mockResolvedValue([]);
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
    expect(await response.json()).toMatchObject({jobId: '4e97908e-4b6d-413a-96e8-d64c560267bc', characterId: 'CHAR01', lineage: {styleBibleHash, styleReferenceImageIds: []}, status: 'queued', model: 'nano_banana_2_lite', credits: 1, reused: false});
    expect(submit).toHaveBeenCalledWith({prompt: 'a valid character reference prompt', imageReferencePaths: [], aspect_ratio: '16:9', resolution: '1k', thinking: 'HIGH'});
  });

  it('resolves approved project asset IDs to server-only native reference paths', async () => {
    const {POST} = await import('./route');
    const referenceId = `ga_${'b'.repeat(32)}`;
    const anchor = {id: referenceId, projectId: 'project-1', state: 'ready', mimeType: 'image/png', styleLineage: {styleBibleHash, styleReferenceImageIds: []}};
    getAsset.mockResolvedValue(anchor);
    listProject.mockResolvedValue([anchor]);
    const root = mkdtempSync(join(tmpdir(), 'clipjs-character-route-'));
    const managedObject = join(root, `${referenceId}.bin`);
    writeFileSync(managedObject, 'verified-image-bytes');
    resolveLocalPath.mockReturnValue(managedObject);
    const response = await POST(makePost({prompt: 'a valid referenced character prompt', styleReferenceImageIds: [referenceId], confirmCreditCost: 1}), context);
    expect(response.status).toBe(202);
    expect(resolveLocalPath).toHaveBeenCalledWith(referenceId);
    const submitted = submit.mock.calls[0][0] as {imageReferencePaths: string[]};
    expect(submitted.imageReferencePaths).toHaveLength(1);
    expect(extname(submitted.imageReferencePaths[0])).toBe('.png');
    expect(submitted.imageReferencePaths[0]).not.toBe(managedObject);
    expect(existsSync(submitted.imageReferencePaths[0])).toBe(false);
    expect(existsSync(managedObject)).toBe(true);
    rmSync(root, {recursive: true, force: true});
  });

  it('rejects a later paid character request before submission when the approved anchor is omitted', async () => {
    const {POST} = await import('./route');
    const anchor = {id: `ga_${'c'.repeat(32)}`, projectId: 'project-1', state: 'ready', mimeType: 'image/png', styleLineage: {styleBibleHash, styleReferenceImageIds: []}};
    listProject.mockResolvedValue([anchor]);
    const response = await POST(makePost({characterId: 'CHAR02', prompt: 'a valid but unreferenced later character prompt', confirmCreditCost: 1}), context);
    expect(response.status).toBe(400);
    expect(submit).not.toHaveBeenCalled();
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

  it('rejects active-job reuse when the paid request prompt changed', async () => {
    const {POST} = await import('./route');
    const first = await POST(makePost({prompt: 'first approved character reference prompt', confirmCreditCost: 1}), context);
    const second = await POST(makePost({prompt: 'second changed character reference prompt', confirmCreditCost: 1}), context);
    expect(first.status).toBe(202);
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({code: 'ACTIVE_REQUEST_MISMATCH'});
    expect(submit).toHaveBeenCalledOnce();
  });

  it('does not reuse one character job for another character', async () => {
    const {POST} = await import('./route');
    await POST(makePost({prompt: 'a valid character reference prompt', confirmCreditCost: 1}), context);
    const response = await POST(makePost({characterId: 'CHAR02', prompt: 'a different valid character prompt', confirmCreditCost: 1}), context);
    expect(response.status).toBe(409);
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
    const response = await GET(makeGet(), context);
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
    const response = await GET(makeGet(), context);
    expect(response.status).toBe(400);
    expect(ingest).not.toHaveBeenCalled();
  });
});
