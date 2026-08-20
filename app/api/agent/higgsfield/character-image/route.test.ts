import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';
import {HIGGSFIELD_WORKER_UPLOAD_MAX_BYTES} from '@/app/lib/higgsfield/result-policy';

const {authorize, createCapability, getBlobAsset, ingestBlob, queue, repository} = vi.hoisted(() => ({
  authorize: vi.fn(),
  createCapability: vi.fn(() => 'capability-token'),
  getBlobAsset: vi.fn(),
  ingestBlob: vi.fn(),
  queue: {
    claim: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    prepareSubmit: vi.fn(),
    recordReceipt: vi.fn(),
  },
  repository: {
    get: vi.fn(),
    markUncertain: vi.fn(),
    recordProviderReceipt: vi.fn(),
    markFailed: vi.fn(),
    markCompleted: vi.fn(),
  },
}));

vi.mock('@/app/lib/security/api-auth', () => ({authorizeAgentRequest: authorize}));
vi.mock('@/app/lib/assets/asset-capability.server', () => ({createAssetCapability: createCapability}));
vi.mock('@/app/lib/assets/character-image-blob-store.server', () => ({
  getCharacterImageBlobAsset: getBlobAsset,
  ingestCharacterImageBlob: ingestBlob,
}));
vi.mock('@/app/lib/higgsfield/character-image-runtime.server', () => ({getCharacterImageSubmissionRepository: () => repository}));
vi.mock('@/app/lib/higgsfield/character-image-worker-queue.server', () => ({createCharacterImageWorkerQueue: () => queue}));

const requestKey = 'a'.repeat(64);
const providerJobId = '4e97908e-4b6d-413a-96e8-d64c560267bc';
const leaseToken = '11111111-1111-4111-8111-111111111111';
const referenceId = `ga_${'b'.repeat(32)}`;
const job = {
  requestKey,
  projectId: 'project-1',
  characterId: 'CHAR01',
  leaseToken,
  styleBibleHash: 'c'.repeat(64),
  styleReferenceImageIds: [referenceId],
};

beforeEach(() => {
  vi.clearAllMocks();
  authorize.mockReturnValue(undefined);
  queue.update.mockResolvedValue(undefined);
  queue.prepareSubmit.mockResolvedValue(undefined);
  repository.markUncertain.mockResolvedValue(undefined);
});

describe('Higgsfield character-image agent route', () => {
  it('dispatches approved references with the maximum valid capability TTL', async () => {
    queue.claim.mockResolvedValueOnce(job);
    repository.get.mockResolvedValueOnce({...job, status: 'submitting'});
    getBlobAsset.mockResolvedValueOnce({
      id: referenceId,
      projectId: job.projectId,
      styleLineage: {styleBibleHash: job.styleBibleHash, styleReferenceImageIds: []},
    });
    const {GET} = await import('./route');

    const response = await GET(new NextRequest('https://clip-js-three.vercel.app/api/agent/higgsfield/character-image', {
      headers: {authorization: 'Bearer test'},
    }));

    expect(response.status).toBe(200);
    expect(createCapability).toHaveBeenCalledWith(job.projectId, referenceId, 600);
    expect(repository.markUncertain).not.toHaveBeenCalled();
  });

  it('prepares the queue before locking the paid submission as uncertain', async () => {
    repository.get.mockResolvedValueOnce({...job, status: 'submitting'});
    const form = new FormData();
    form.set('action', 'prepare');
    form.set('requestKey', requestKey);
    form.set('leaseToken', leaseToken);
    const {POST} = await import('./route');

    const response = await POST(new NextRequest('https://clip-js-three.vercel.app/api/agent/higgsfield/character-image', {
      method: 'POST', headers: {authorization: 'Bearer test'}, body: form,
    }));

    expect(response.status).toBe(200);
    expect(queue.prepareSubmit).toHaveBeenCalledWith(requestKey, leaseToken);
    expect(queue.prepareSubmit.mock.invocationCallOrder[0]).toBeLessThan(repository.markUncertain.mock.invocationCallOrder[0]);
  });

  it('recovers a queue receipt before resuming provider polling', async () => {
    queue.claim.mockResolvedValueOnce({...job, providerJobId});
    repository.get.mockResolvedValueOnce({...job, status: 'uncertain'});
    repository.recordProviderReceipt.mockResolvedValueOnce({...job, status: 'queued', providerJobId});
    getBlobAsset.mockResolvedValueOnce({id: referenceId, projectId: job.projectId, styleLineage: {styleBibleHash: job.styleBibleHash, styleReferenceImageIds: []}});
    const {GET} = await import('./route');

    const response = await GET(new NextRequest('https://clip-js-three.vercel.app/api/agent/higgsfield/character-image', {headers: {authorization: 'Bearer test'}}));

    expect(response.status).toBe(200);
    expect(repository.recordProviderReceipt).toHaveBeenCalledWith(requestKey, providerJobId);
    expect(await response.json()).toMatchObject({resumeProviderJobId: providerJobId});
  });

  it('does not downgrade a durable receipt when only its HTTP response was lost', async () => {
    repository.get.mockResolvedValueOnce({...job, status: 'queued', providerJobId});
    queue.get.mockResolvedValueOnce({...job, status: 'submitted', providerJobId});
    const form = new FormData();
    form.set('action', 'uncertain');
    form.set('requestKey', requestKey);
    form.set('providerJobId', providerJobId);
    form.set('leaseToken', leaseToken);
    form.set('reason', 'receipt response was lost');
    const {POST} = await import('./route');

    const response = await POST(new NextRequest('https://clip-js-three.vercel.app/api/agent/higgsfield/character-image', {
      method: 'POST',
      headers: {authorization: 'Bearer test'},
      body: form,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({receiptAlreadyRecorded: true});
    expect(repository.markUncertain).not.toHaveBeenCalled();
    expect(queue.update).not.toHaveBeenCalled();
  });

  it('cancels a leased queued request only before any provider receipt exists', async () => {
    repository.get.mockResolvedValueOnce({...job, status: 'submitting'});
    queue.get.mockResolvedValueOnce({...job, status: 'leased'});
    const form = new FormData();
    form.set('action', 'cancel-queued');
    form.set('requestKey', requestKey);
    form.set('leaseToken', leaseToken);
    const {POST} = await import('./route');

    const response = await POST(new NextRequest('https://clip-js-three.vercel.app/api/agent/higgsfield/character-image', {
      method: 'POST', headers: {authorization: 'Bearer test'}, body: form,
    }));

    expect(response.status).toBe(200);
    expect(repository.markFailed).toHaveBeenCalledWith(requestKey, 'Cancelled by the operator before provider submission.');
    expect(queue.update).toHaveBeenCalledWith(requestKey, leaseToken, 'failed', {lastError: 'Cancelled by the operator before provider submission.'});
  });

  it('refuses queued cancellation when a provider receipt is already known', async () => {
    repository.get.mockResolvedValueOnce({...job, status: 'queued', providerJobId});
    queue.get.mockResolvedValueOnce({...job, status: 'submitted', providerJobId});
    const form = new FormData();
    form.set('action', 'cancel-queued');
    form.set('requestKey', requestKey);
    form.set('leaseToken', leaseToken);
    const {POST} = await import('./route');

    const response = await POST(new NextRequest('https://clip-js-three.vercel.app/api/agent/higgsfield/character-image', {
      method: 'POST', headers: {authorization: 'Bearer test'}, body: form,
    }));

    expect(response.status).toBe(400);
    expect(repository.markFailed).not.toHaveBeenCalled();
    expect(queue.update).not.toHaveBeenCalled();
  });

  it('rejects an image above the Vercel multipart upload budget before Blob ingest', async () => {
    repository.get.mockResolvedValueOnce({...job, status: 'queued', providerJobId});
    const form = new FormData();
    form.set('action', 'complete');
    form.set('requestKey', requestKey);
    form.set('providerJobId', providerJobId);
    form.set('file', new File([new Uint8Array(HIGGSFIELD_WORKER_UPLOAD_MAX_BYTES + 1)], 'result.png', {type: 'image/png'}));
    const {POST} = await import('./route');

    const response = await POST(new NextRequest('https://clip-js-three.vercel.app/api/agent/higgsfield/character-image', {
      method: 'POST', headers: {authorization: 'Bearer test'}, body: form,
    }));

    expect(response.status).toBe(400);
    expect(ingestBlob).not.toHaveBeenCalled();
  });
});
