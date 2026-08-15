import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {extname, join} from 'node:path';
import {tmpdir} from 'node:os';

vi.mock('server-only', () => ({}));
const authorizeApproval = vi.fn();
vi.mock('@/app/lib/security/api-auth', () => ({authorizeApprovalRequest: authorizeApproval}));
const submit = vi.fn();
const getJob = vi.fn();
const ingest = vi.fn();
const createCapability = vi.fn(() => 'preview-token');
const getAsset = vi.fn();
const listProject = vi.fn();
const resolveLocalPath = vi.fn((id: string) => `C:\\clipjs\\${id}.bin`);
const getGeneratedAssetStore = vi.fn(() => ({kind: 'test-store', get: getAsset, listProject, resolveLocalPath}));
const getBlobAsset = vi.fn();
const listBlobAssets = vi.fn();
const styleBibleHash = 'a'.repeat(64);
const attemptId = '11111111-1111-4111-8111-111111111111';
const submissionDirectories: string[] = [];
const repositoryFaults = vi.hoisted(() => ({failReceipt: false}));
const workerRuntime = vi.hoisted(() => ({
  enabled: false,
  repository: {
    claim: vi.fn(),
    findByAttempt: vi.fn(),
    recordProviderReceipt: vi.fn(),
    markFailed: vi.fn(),
  },
  queue: {get: vi.fn(), update: vi.fn(), recoverReceipt: vi.fn(), enqueue: vi.fn()},
}));
vi.mock('@/app/lib/higgsfield/character-image-runtime.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/lib/higgsfield/character-image-runtime.server')>();
  return {
    ...actual,
    isCharacterImageWorkerMode: () => workerRuntime.enabled,
    getCharacterImageSubmissionRepository: () => workerRuntime.enabled ? workerRuntime.repository : actual.getCharacterImageSubmissionRepository(),
  };
});
vi.mock('@/app/lib/higgsfield/character-image-worker-queue.server', () => ({
  createCharacterImageWorkerQueue: () => workerRuntime.queue,
}));
vi.mock('@/app/lib/higgsfield/generate.server', () => ({
  submitHiggsfieldCharacterImageJob: submit,
  getHiggsfieldGenerationJob: getJob,
  parseHiggsfieldSubmittedJobId: (value: unknown) => Array.isArray(value) ? value[0] : (value as {id?: string})?.id,
}));
vi.mock('@/app/lib/assets/secure-higgsfield-image-ingest.server', () => ({ingestHiggsfieldCharacterImage: ingest}));
vi.mock('@/app/lib/assets/asset-capability.server', () => ({createAssetCapability: createCapability}));
vi.mock('@/app/lib/generation/runtime.server', () => ({getGeneratedAssetStore}));
vi.mock('@/app/lib/assets/character-image-blob-store.server', () => ({
  getCharacterImageBlobAsset: getBlobAsset,
  listCharacterImageBlobAssets: listBlobAssets,
}));
vi.mock('@/app/lib/higgsfield/character-image-submission-repository.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/lib/higgsfield/character-image-submission-repository.server')>();
  return {
    ...actual,
    createFilesystemCharacterImageSubmissionRepository: (options: Parameters<typeof actual.createFilesystemCharacterImageSubmissionRepository>[0]) => {
      const repository = actual.createFilesystemCharacterImageSubmissionRepository(options);
      return repositoryFaults.failReceipt
        ? {...repository, recordProviderReceipt: vi.fn(async () => { throw new Error('injected receipt persistence failure'); })}
        : repository;
    },
  };
});

const context = {params: Promise.resolve({projectId: 'project-1'})};
const makePost = (body: unknown, origin = 'http://localhost') => new NextRequest('http://localhost/api/projects/project-1/character-image', {
  method: 'POST',
  headers: {origin, 'sec-fetch-site': origin === 'http://localhost' ? 'same-origin' : 'cross-site', 'content-type': 'application/json'},
  body: JSON.stringify({characterId: 'CHAR01', attemptId, styleBibleHash, styleReferenceImageIds: [], ...(body as object)}),
});
const makeGet = (characterId = 'CHAR01') => new NextRequest(`http://localhost/api/projects/project-1/character-image?jobId=4e97908e-4b6d-413a-96e8-d64c560267bc&characterId=${characterId}`, {headers: {origin: 'http://localhost', 'sec-fetch-site': 'same-origin'}});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  authorizeApproval.mockReturnValue(undefined);
  repositoryFaults.failReceipt = false;
  workerRuntime.enabled = false;
  workerRuntime.repository.claim.mockReset();
  workerRuntime.repository.findByAttempt.mockReset();
  workerRuntime.repository.recordProviderReceipt.mockReset();
  workerRuntime.repository.markFailed.mockReset();
  workerRuntime.queue.get.mockReset();
  workerRuntime.queue.update.mockReset();
  workerRuntime.queue.recoverReceipt.mockReset();
  workerRuntime.queue.enqueue.mockReset();
  getGeneratedAssetStore.mockImplementation(() => ({kind: 'test-store', get: getAsset, listProject, resolveLocalPath}));
  getBlobAsset.mockReset();
  listBlobAssets.mockReset();
  listBlobAssets.mockResolvedValue([]);
  vi.stubEnv('CLIPJS_HIGGSFIELD_CHARACTER_IMAGE_SUBMIT_ENABLED', 'true');
  const submissionDirectory = mkdtempSync(join(tmpdir(), 'clipjs-character-image-route-claims-'));
  submissionDirectories.push(submissionDirectory);
  vi.stubEnv('CLIPJS_CHARACTER_IMAGE_REPOSITORY_DIR', submissionDirectory);
  submit.mockResolvedValue(['4e97908e-4b6d-413a-96e8-d64c560267bc']);
  getJob.mockResolvedValue({id: '4e97908e-4b6d-413a-96e8-d64c560267bc', status: 'completed', job_type: 'nano_banana_2_lite', result_url: 'https://d8j0ntlcm91z4.cloudfront.net/result.png'});
  ingest.mockResolvedValue({assetId: 'ga_0123456789abcdef0123456789abcdef', contentSha256: 'a'.repeat(64)});
  getAsset.mockImplementation(async (id: string) => ({id, projectId: 'project-1', state: 'ready', mimeType: 'image/png'}));
  listProject.mockResolvedValue([]);
});

afterEach(() => {
  submissionDirectories.splice(0).forEach((path) => rmSync(path, {recursive: true, force: true}));
  vi.unstubAllEnvs();
});

describe('project character image generation route', () => {
  it('recovers an uncertain worker request using a verified provider receipt', async () => {
    workerRuntime.enabled = true;
    const uncertain = {requestKey: 'c'.repeat(64), projectId: 'project-1', characterId: 'CHAR01', attemptId, status: 'uncertain'};
    workerRuntime.repository.findByAttempt.mockResolvedValueOnce(uncertain);
    workerRuntime.queue.get.mockResolvedValueOnce({...uncertain, status: 'prepared'});
    const providerJobId = '4e97908e-4b6d-413a-96e8-d64c560267bc';
    const {POST} = await import('./route');
    const response = await POST(makePost({recoveryAction: 'attach-provider', providerJobId}), context);
    expect(response.status).toBe(200);
    expect(workerRuntime.queue.recoverReceipt).toHaveBeenCalledWith(uncertain.requestKey, providerJobId);
    expect(workerRuntime.repository.recordProviderReceipt).toHaveBeenCalledWith(uncertain.requestKey, providerJobId);
  });

  it('unlocks an uncertain request only after explicit provider non-submission confirmation', async () => {
    workerRuntime.enabled = true;
    const uncertain = {requestKey: 'd'.repeat(64), projectId: 'project-1', characterId: 'CHAR01', attemptId, status: 'uncertain'};
    workerRuntime.repository.findByAttempt.mockResolvedValue(uncertain);
    workerRuntime.queue.get.mockResolvedValue({...uncertain, status: 'prepared'});
    const {POST} = await import('./route');
    const rejected = await POST(makePost({recoveryAction: 'confirm-not-submitted', confirmation: ''}), context);
    expect(rejected.status).toBe(400);
    expect(workerRuntime.repository.markFailed).not.toHaveBeenCalled();
    const recovered = await POST(makePost({recoveryAction: 'confirm-not-submitted', confirmation: 'PROVIDER_NOT_SUBMITTED'}), context);
    expect(recovered.status).toBe(200);
    expect(workerRuntime.repository.markFailed).toHaveBeenCalledWith(uncertain.requestKey, expect.stringMatching(/Operator confirmed/));
  });

  it('recovers a prepared queue record even when the repository commit stayed submitting', async () => {
    workerRuntime.enabled = true;
    const partial = {requestKey: 'f'.repeat(64), projectId: 'project-1', characterId: 'CHAR01', attemptId, status: 'submitting'};
    workerRuntime.repository.findByAttempt.mockResolvedValue(partial);
    workerRuntime.queue.get.mockResolvedValue({...partial, status: 'prepared'});
    const {GET, POST} = await import('./route');

    const statusResponse = await GET(new NextRequest(`http://localhost/api/projects/project-1/character-image?jobId=${attemptId}&characterId=CHAR01`, {headers: {origin: 'http://localhost', 'sec-fetch-site': 'same-origin'}}), context);
    expect(await statusResponse.json()).toMatchObject({status: 'uncertain', recoveryRequired: true});

    const recovered = await POST(makePost({recoveryAction: 'confirm-not-submitted', confirmation: 'PROVIDER_NOT_SUBMITTED'}), context);
    expect(recovered.status).toBe(200);
    expect(workerRuntime.repository.markFailed).toHaveBeenCalledWith(partial.requestKey, expect.stringMatching(/Operator confirmed/));
  });

  it('never unlocks an uncertain request that already has a provider receipt', async () => {
    workerRuntime.enabled = true;
    const providerJobId = '4e97908e-4b6d-413a-96e8-d64c560267bc';
    const uncertain = {requestKey: 'e'.repeat(64), projectId: 'project-1', characterId: 'CHAR01', attemptId, status: 'uncertain', providerJobId};
    workerRuntime.repository.findByAttempt.mockResolvedValueOnce(uncertain);
    workerRuntime.queue.get.mockResolvedValueOnce({...uncertain, status: 'submitted'});
    const {POST} = await import('./route');
    const response = await POST(makePost({recoveryAction: 'confirm-not-submitted', confirmation: 'PROVIDER_NOT_SUBMITTED'}), context);
    expect(response.status).toBe(400);
    expect(workerRuntime.repository.markFailed).not.toHaveBeenCalled();
  });

  it('rejects paid submission before claiming when operator approval is invalid', async () => {
    authorizeApproval.mockImplementationOnce(() => { throw new Error('Unauthorized approval request.'); });
    const {POST} = await import('./route');
    const response = await POST(makePost({prompt: 'A complete character image prompt.', confirmCreditCost: 1}), context);
    expect(response.status).toBe(401);
    expect(submit).not.toHaveBeenCalled();
  });

  it('requires explicit approval of exactly one credit', async () => {
    const {POST} = await import('./route');
    const response = await POST(makePost({prompt: 'a valid character reference prompt', confirmCreditCost: 0}), context);
    expect(response.status).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });

  it('does not initialize the local filesystem asset store for a production worker submission', async () => {
    workerRuntime.enabled = true;
    workerRuntime.repository.claim.mockResolvedValue({
      created: true,
      record: {status: 'submitting'},
    });
    getGeneratedAssetStore.mockImplementation(() => { throw new Error("ENOENT: mkdir '/var/task/.clipjs-runtime/assets/objects'"); });
    const {POST} = await import('./route');

    const response = await POST(makePost({prompt: 'a valid bootstrap character prompt', confirmCreditCost: 1}), context);

    expect(response.status).toBe(202);
    expect(getGeneratedAssetStore).not.toHaveBeenCalled();
    expect(workerRuntime.queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      characterId: 'CHAR01',
      styleReferenceImageIds: [],
      expectedCredits: 1,
    }));
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

  it('atomically deduplicates concurrent paid submissions for the same attempt', async () => {
    let releaseProvider!: (value: string[]) => void;
    submit.mockImplementation(() => new Promise<string[]>((resolve) => { releaseProvider = resolve; }));
    const {POST} = await import('./route');
    const pending = Promise.all([
      POST(makePost({prompt: 'a concurrent approved character prompt', confirmCreditCost: 1}), context),
      POST(makePost({prompt: 'a concurrent approved character prompt', confirmCreditCost: 1}), context),
    ]);
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
    releaseProvider(['4e97908e-4b6d-413a-96e8-d64c560267bc']);
    const [first, second] = await pending;
    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([202, 409]);
    const blocked = first.status === 409 ? first : second;
    expect(await blocked.json()).toMatchObject({code: 'SUBMISSION_IN_PROGRESS'});
    expect(submit).toHaveBeenCalledOnce();
  });

  it('does not replay a paid submission after an uncertain provider response', async () => {
    submit.mockRejectedValueOnce(new Error('provider response lost'));
    const {POST} = await import('./route');
    const first = await POST(makePost({prompt: 'an uncertain approved character prompt', confirmCreditCost: 1}), context);
    const second = await POST(makePost({prompt: 'an uncertain approved character prompt', confirmCreditCost: 1}), context);
    expect(first.status).toBeGreaterThanOrEqual(400);
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({code: 'SUBMISSION_UNCERTAIN'});
    expect(submit).toHaveBeenCalledOnce();
  });

  it('returns a known provider job ID and recovers through GET when receipt persistence fails', async () => {
    repositoryFaults.failReceipt = true;
    const {GET, POST} = await import('./route');
    const submitted = await POST(makePost({prompt: 'a receipt recovery prompt', confirmCreditCost: 1}), context);
    expect(submitted.status).toBe(503);
    const payload = await submitted.json();
    expect(payload).toMatchObject({code: 'SUBMISSION_UNCERTAIN', jobId: '4e97908e-4b6d-413a-96e8-d64c560267bc'});
    const repositoryModule = await import('@/app/lib/higgsfield/character-image-submission-repository.server');
    const durableRepository = repositoryModule.createFilesystemCharacterImageSubmissionRepository({rootDirectory: process.env.CLIPJS_CHARACTER_IMAGE_REPOSITORY_DIR!});
    expect(await durableRepository.findByProviderJob('project-1', payload.jobId)).toMatchObject({status: 'uncertain', characterId: 'CHAR01'});
    const recovered = await GET(makeGet(), context);
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({status: 'completed', characterId: 'CHAR01'});
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

  it('fails closed before provider submission in production even when a repository path is configured', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const {POST} = await import('./route');
    const response = await POST(makePost({prompt: 'a production persistence guard prompt', confirmCreditCost: 1}), context);
    expect(response.status).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });

  it('reuses the durable queued receipt after reload even when the client creates a new attempt ID', async () => {
    const firstModule = await import('./route');
    const prompt = 'an exact durable reload dedupe prompt';
    expect((await firstModule.POST(makePost({prompt, confirmCreditCost: 1}), context)).status).toBe(202);
    vi.resetModules();
    const restartedModule = await import('./route');
    const response = await restartedModule.POST(makePost({
      attemptId: '22222222-2222-4222-8222-222222222222',
      prompt,
      confirmCreditCost: 1,
    }), context);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({reused: true});
    expect(submit).toHaveBeenCalledOnce();
  });

  it('normalizes cancelled provider status and releases the terminal billing scope', async () => {
    const {GET, POST} = await import('./route');
    const prompt = 'a cancelled terminal recovery prompt';
    expect((await POST(makePost({prompt, confirmCreditCost: 1}), context)).status).toBe(202);
    getJob.mockResolvedValue({id: '4e97908e-4b6d-413a-96e8-d64c560267bc', status: 'CANCELLED', job_type: 'nano_banana_2_lite'});
    const terminal = await GET(makeGet(), context);
    expect(terminal.status).toBe(200);
    expect(await terminal.json()).toMatchObject({status: 'cancelled'});
    const retry = await POST(makePost({attemptId: '22222222-2222-4222-8222-222222222222', prompt, confirmCreditCost: 1}), context);
    expect(retry.status).toBe(202);
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('recovers an accepted paid job from the durable receipt after a route restart', async () => {
    const firstModule = await import('./route');
    const submitted = await firstModule.POST(makePost({prompt: 'a durable restart recovery prompt', confirmCreditCost: 1}), context);
    expect(submitted.status).toBe(202);
    vi.resetModules();
    const restartedModule = await import('./route');
    const response = await restartedModule.GET(makeGet(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({status: 'completed', characterId: 'CHAR01'});
    expect(submit).toHaveBeenCalledOnce();
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
