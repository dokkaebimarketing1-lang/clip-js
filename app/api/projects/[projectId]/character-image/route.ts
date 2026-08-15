import {NextRequest, NextResponse} from 'next/server';
import {authorizeApprovalRequest} from '@/app/lib/security/api-auth';
import {createAssetCapability} from '@/app/lib/assets/asset-capability.server';
import {getCharacterImageBlobAsset, listCharacterImageBlobAssets} from '@/app/lib/assets/character-image-blob-store.server';
import {ingestHiggsfieldCharacterImage} from '@/app/lib/assets/secure-higgsfield-image-ingest.server';
import {getGeneratedAssetStore} from '@/app/lib/generation/runtime.server';
import {getHiggsfieldGenerationJob, parseHiggsfieldSubmittedJobId, submitHiggsfieldCharacterImageJob} from '@/app/lib/higgsfield/generate.server';
import {
  CharacterImageSubmissionConflictError,
  computeCharacterImageRequestKey,
} from '@/app/lib/higgsfield/character-image-submission-repository.server';
import {getCharacterImageSubmissionRepository, isCharacterImageWorkerMode} from '@/app/lib/higgsfield/character-image-runtime.server';
import {createCharacterImageWorkerQueue} from '@/app/lib/higgsfield/character-image-worker-queue.server';
import {stageHiggsfieldImageReferences} from '@/app/lib/higgsfield/image-reference-staging.server';
import {readLimitedJson} from '@/app/lib/security/request-body';
import {sha256} from '@/app/lib/workflow/hash';

export const runtime = 'nodejs';
export const maxDuration = 60;

const UUID = /^[a-f0-9-]{36}$/i;
type ImageLineage = {styleBibleHash: string; styleReferenceImageIds: string[]};
class CharacterImageSubmissionUncertainError extends Error {
  constructor(message: string, public readonly jobId?: string) {
    super(message);
    this.name = 'CharacterImageSubmissionUncertainError';
  }
}
const activeProjects = new Map<string, {jobId: string; characterId: string; lineage: ImageLineage; requestHash: string}>();
const ingestedJobs = new Map<string, {projectId: string; characterId: string; assetId: string; contentSha256: string; lineage: ImageLineage}>();

const getSubmissionRepository = () => getCharacterImageSubmissionRepository();

const assertSameOrigin = (request: NextRequest) => {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') throw new Error('Cross-site generation is not allowed.');
  if (!origin && fetchSite !== 'same-origin') throw new Error('Browser same-origin context is required.');
  if (fetchSite === 'same-origin') return;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const protocol = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '');
  const expected = host ? `${protocol}://${host}` : request.nextUrl.origin;
  if (origin !== expected && origin !== request.nextUrl.origin) throw new Error('Cross-origin generation is not allowed.');
};


const previewPayload = (projectId: string, asset: {assetId: string; contentSha256: string}) => {
  const token = createAssetCapability(projectId, asset.assetId);
  return {...asset, previewUrl: `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(asset.assetId)}?token=${encodeURIComponent(token)}`};
};

export async function POST(request: NextRequest, context: {params: Promise<{projectId: string}>}) {
  let projectId = '';
  try {
    authorizeApprovalRequest(request);
    assertSameOrigin(request);
    ({projectId} = await context.params);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(projectId)) throw new Error('Invalid project ID.');
    const body = await readLimitedJson(request) as Record<string, unknown>;
    const recoveryAction = typeof body.recoveryAction === 'string' ? body.recoveryAction : '';
    if (recoveryAction) {
      if (!isCharacterImageWorkerMode()) throw new Error('Character image recovery requires worker mode.');
      const attemptId = typeof body.attemptId === 'string' ? body.attemptId : '';
      const characterId = typeof body.characterId === 'string' ? body.characterId : '';
      if (!UUID.test(attemptId) || !/^CHAR\d{2}$/.test(characterId)) throw new Error('Invalid character image recovery identity.');
      const repository = getSubmissionRepository();
      const submission = await repository.findByAttempt(projectId, attemptId);
      if (!submission || submission.characterId !== characterId) throw new Error('No matching character image request exists.');
      const queue = createCharacterImageWorkerQueue();
      const queuedJob = await queue.get(submission.requestKey);
      const recoverable = submission.status === 'uncertain' || (submission.status === 'submitting' && queuedJob?.status === 'prepared');
      if (!recoverable || !queuedJob || !['prepared', 'uncertain', 'submitted'].includes(queuedJob.status)) throw new Error('No matching recoverable worker job exists.');
      if (recoveryAction === 'attach-provider') {
        const providerJobId = typeof body.providerJobId === 'string' ? body.providerJobId : '';
        if (!UUID.test(providerJobId)) throw new Error('A valid provider job ID is required.');
        if (queuedJob.providerJobId && queuedJob.providerJobId !== providerJobId) throw new Error('Worker job already has a different provider receipt.');
        await queue.recoverReceipt(submission.requestKey, providerJobId);
        await repository.recordProviderReceipt(submission.requestKey, providerJobId);
        return NextResponse.json({ok: true, status: 'queued', jobId: attemptId, providerJobId});
      }
      if (recoveryAction === 'confirm-not-submitted') {
        if (submission.providerJobId || queuedJob.providerJobId) throw new Error('A known provider receipt must be recovered instead of unlocked.');
        if (body.confirmation !== 'PROVIDER_NOT_SUBMITTED') throw new Error('Explicit provider non-submission confirmation is required.');
        await repository.markFailed(submission.requestKey, 'Operator confirmed that the prepared request was not submitted to the provider.');
        await queue.update(submission.requestKey, undefined, 'failed', {lastError: 'Operator confirmed no provider submission.'});
        return NextResponse.json({ok: true, status: 'failed', jobId: attemptId});
      }
      throw new Error('Unknown character image recovery action.');
    }
    if (process.env.CLIPJS_HIGGSFIELD_CHARACTER_IMAGE_SUBMIT_ENABLED !== 'true') {
      return NextResponse.json({error: 'Higgsfield image generation is disabled.', code: 'PROVIDER_DISABLED'}, {status: 410});
    }
    const characterId = typeof body.characterId === 'string' ? body.characterId : '';
    const attemptId = typeof body.attemptId === 'string' ? body.attemptId : '';
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    const styleBibleHash = typeof body.styleBibleHash === 'string' ? body.styleBibleHash : '';
    const styleReferenceImageIds = Array.isArray(body.styleReferenceImageIds) ? body.styleReferenceImageIds.filter((id): id is string => typeof id === 'string') : [];
    if (!/^CHAR\d{2}$/.test(characterId) || !UUID.test(attemptId) || !/^[a-f0-9]{64}$/.test(styleBibleHash) || styleReferenceImageIds.length > 14
      || body.confirmCreditCost !== 1 || prompt.length < 10 || prompt.length > 4000) throw new Error('Explicit 1-credit approval, character identity, style lineage, and a valid prompt are required.');
    const workerMode = isCharacterImageWorkerMode();
    const assetStore = getGeneratedAssetStore();
    const referenceAssets = await Promise.all(styleReferenceImageIds.map((id) => workerMode ? getCharacterImageBlobAsset(id) : assetStore.get(id)));
    if (referenceAssets.some((asset) => !asset || asset.projectId !== projectId || asset.state !== 'ready' || !asset.mimeType.startsWith('image/')
      || asset.styleLineage?.styleBibleHash !== styleBibleHash)) {
      throw new Error('Style reference image is unavailable, has different lineage, or belongs to another project.');
    }
    const projectAssets = workerMode ? await listCharacterImageBlobAssets(projectId) : await assetStore.listProject(projectId);
    const anchors = projectAssets.filter((asset) => asset.state === 'ready' && asset.mimeType.startsWith('image/')
      && asset.styleLineage?.styleBibleHash === styleBibleHash && asset.styleLineage.styleReferenceImageIds.length === 0);
    if (anchors.length > 0 && !anchors.some((anchor) => styleReferenceImageIds.includes(anchor.id))) {
      throw new Error('A later character image must reference the approved project style anchor.');
    }
    const lineage = {styleBibleHash, styleReferenceImageIds};
    const requestHash = await sha256({characterId, prompt, lineage, model: 'nano_banana_2_lite', aspectRatio: '16:9', resolution: '1k', thinking: 'HIGH', expectedCredits: 1});
    const active = activeProjects.get(projectId);
    if (active) {
      if (active.characterId !== characterId) {
        return NextResponse.json({error: '다른 캐릭터 이미지 생성이 처리 중입니다.', code: 'ANOTHER_CHARACTER_ACTIVE'}, {status: 409});
      }
      if (active.lineage.styleBibleHash !== styleBibleHash || active.lineage.styleReferenceImageIds.join(',') !== styleReferenceImageIds.join(',')) throw new Error('Active image job lineage does not match.');
      if (active.requestHash !== requestHash) {
        return NextResponse.json({error: '진행 중인 이미지 생성 요청과 현재 요청이 다릅니다.', code: 'ACTIVE_REQUEST_MISMATCH'}, {status: 409});
      }
      return NextResponse.json({jobId: active.jobId, characterId, lineage, status: 'queued', model: 'nano_banana_2_lite', credits: 1, reused: true}, {status: 202});
    }
    const repository = getSubmissionRepository();
    const requestKey = computeCharacterImageRequestKey(projectId, attemptId, requestHash);
    const staged = workerMode
      ? {paths: [] as string[], cleanup: () => undefined}
      : stageHiggsfieldImageReferences(referenceAssets.map((asset) => ({
        assetId: asset!.id,
        sourcePath: assetStore.resolveLocalPath(asset!.id),
        mimeType: asset!.mimeType,
      })));
    let claim;
    try {
      claim = await repository.claim({
        projectId,
        characterId,
        attemptId,
        requestKey,
        requestHash,
        styleBibleHash,
        styleReferenceImageIds,
      });
    } catch (error) {
      staged.cleanup();
      if (error instanceof CharacterImageSubmissionConflictError) {
        return NextResponse.json({error: '다른 캐릭터 이미지 유료 요청이 해결되지 않았습니다.', code: error.code}, {status: 409});
      }
      throw error;
    }
    if (workerMode) {
      staged.cleanup();
      if (claim.record.status === 'uncertain') {
        return NextResponse.json({error: '이 유료 요청의 provider 접수 여부가 불확실해 재실행을 차단했습니다.', code: 'SUBMISSION_UNCERTAIN'}, {status: 409});
      }
      if (claim.record.status === 'failed') {
        return NextResponse.json({error: claim.record.lastError || '이 이미지 생성 요청은 실패했습니다.', code: 'SUBMISSION_FAILED'}, {status: 409});
      }
      if (claim.record.status === 'completed' && claim.record.assetId) {
        const asset = await getCharacterImageBlobAsset(claim.record.assetId);
        if (!asset) throw new Error('Completed character image asset is unavailable.');
        return NextResponse.json({jobId: attemptId, characterId, lineage, status: 'completed', model: 'nano_banana_2_lite', credits: 1, reused: true, ...previewPayload(projectId, {assetId: asset.id, contentSha256: asset.contentSha256})});
      }
      await createCharacterImageWorkerQueue().enqueue({
        requestKey,
        projectId,
        characterId,
        attemptId,
        prompt,
        styleBibleHash,
        styleReferenceImageIds,
        model: 'nano_banana_2_lite',
        aspectRatio: '16:9',
        resolution: '1k',
        thinking: 'HIGH',
        expectedCredits: 1,
      });
      return NextResponse.json({jobId: attemptId, characterId, lineage, status: claim.record.status === 'queued' ? 'queued' : 'pending-worker', model: 'nano_banana_2_lite', credits: 1, reused: !claim.created}, {status: 202});
    }
    if (!claim.created) {
      staged.cleanup();
      if (claim.record.status === 'queued' && claim.record.providerJobId) {
        activeProjects.set(projectId, {jobId: claim.record.providerJobId, characterId, lineage, requestHash});
        return NextResponse.json({jobId: claim.record.providerJobId, characterId, lineage, status: 'queued', model: 'nano_banana_2_lite', credits: 1, reused: true}, {status: 202});
      }
      if (claim.record.status === 'uncertain') {
        return NextResponse.json({error: '이 유료 요청의 provider 접수 여부가 불확실해 재실행을 차단했습니다.', code: 'SUBMISSION_UNCERTAIN'}, {status: 409});
      }
      return NextResponse.json({error: '동일한 유료 요청이 이미 처리 중이거나 종료됐습니다.', code: 'SUBMISSION_IN_PROGRESS'}, {status: 409});
    }
    let result: unknown;
    try {
      result = await submitHiggsfieldCharacterImageJob({prompt, imageReferencePaths: staged.paths, aspect_ratio: '16:9', resolution: '1k', thinking: 'HIGH'});
    } catch (error) {
      await repository.markUncertain(requestKey, 'Provider submission response was lost or rejected without a durable receipt.');
      throw new CharacterImageSubmissionUncertainError(error instanceof Error ? error.message : 'Provider response lost.');
    } finally {
      staged.cleanup();
    }
    const jobId = parseHiggsfieldSubmittedJobId(result);
    if (!jobId) {
      await repository.markUncertain(requestKey, 'Provider response did not contain a valid job ID.');
      throw new CharacterImageSubmissionUncertainError('Higgsfield did not return a valid job ID.');
    }
    activeProjects.set(projectId, {jobId, characterId, lineage, requestHash});
    try {
      await repository.recordProviderReceipt(requestKey, jobId);
    } catch (error) {
      try {
        await repository.markUncertain(requestKey, 'Provider accepted the request but its receipt could not be committed.', jobId);
      } catch {
        // The original submitting claim remains durable and blocks replay; the known job ID still enables GET recovery.
      }
      throw new CharacterImageSubmissionUncertainError(error instanceof Error ? error.message : 'Provider receipt persistence failed.', jobId);
    }
    return NextResponse.json({jobId, characterId, lineage, status: 'queued', model: 'nano_banana_2_lite', credits: 1, reused: false}, {status: 202});
  } catch (error) {
    console.error('Higgsfield character image submission rejected.', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : 'Unknown submission error',
    });
    if (error instanceof CharacterImageSubmissionUncertainError) {
      return NextResponse.json({error: 'provider 접수 여부가 불확실해 같은 요청의 재실행을 차단했습니다.', code: 'SUBMISSION_UNCERTAIN', jobId: error.jobId}, {status: 503});
    }
    if (error instanceof Error && /Unauthorized|CLIPJS_APPROVAL_TOKEN/i.test(error.message)) {
      return NextResponse.json({error: '운영 승인 권한을 확인하지 못했습니다.', code: 'UNAUTHORIZED'}, {status: 401});
    }
    return NextResponse.json({error: '캐릭터 이미지 생성 요청을 시작하지 못했습니다.', code: 'IMAGE_SUBMISSION_REJECTED'}, {status: 400});
  }
}

export async function GET(request: NextRequest, context: {params: Promise<{projectId: string}>}) {
  try {
    assertSameOrigin(request);
    const {projectId} = await context.params;
    const jobId = request.nextUrl.searchParams.get('jobId') ?? '';
    const characterId = request.nextUrl.searchParams.get('characterId') ?? '';
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(projectId) || !UUID.test(jobId) || !/^CHAR\d{2}$/.test(characterId)) throw new Error('Invalid generation lookup.');
    const cached = ingestedJobs.get(jobId);
    if (cached) {
      if (cached.projectId !== projectId || cached.characterId !== characterId) throw new Error('This image result belongs to another project or character.');
      return NextResponse.json({jobId, characterId, lineage: cached.lineage, status: 'completed', ...previewPayload(projectId, cached)});
    }
    const repository = getSubmissionRepository();
    if (isCharacterImageWorkerMode()) {
      const durable = await repository.findByAttempt(projectId, jobId);
      if (!durable || durable.characterId !== characterId) throw new Error('This image job is not active for the project character.');
      const lineage = {styleBibleHash: durable.styleBibleHash, styleReferenceImageIds: durable.styleReferenceImageIds};
      if (durable.status === 'completed' && durable.assetId) {
        const asset = await getCharacterImageBlobAsset(durable.assetId);
        if (!asset || asset.projectId !== projectId) throw new Error('Completed character image asset is unavailable.');
        return NextResponse.json({jobId, characterId, lineage, status: 'completed', ...previewPayload(projectId, {assetId: asset.id, contentSha256: asset.contentSha256})});
      }
      if (durable.status === 'submitting') {
        const queuedJob = await createCharacterImageWorkerQueue().get(durable.requestKey);
        if (queuedJob?.status === 'prepared') {
          return NextResponse.json({jobId, status: 'uncertain', code: 'SUBMISSION_UNCERTAIN', recoveryRequired: true, error: 'provider 제출 준비 이후 상태 확정이 중단됐습니다. 접수 여부를 확인해 주세요.'});
        }
      }
      if (durable.status === 'failed') return NextResponse.json({jobId, status: 'failed', error: durable.lastError || '이미지 생성에 실패했습니다.'});
      if (durable.status === 'uncertain') return NextResponse.json({jobId, status: 'uncertain', code: 'SUBMISSION_UNCERTAIN', recoveryRequired: true, error: 'provider 접수 여부가 불확실해 자동 재실행하지 않습니다.'});
      return NextResponse.json({jobId, status: durable.status === 'queued' ? 'queued' : 'pending-worker'});
    }
    let active = activeProjects.get(projectId);
    const durable = await repository.findByProviderJob(projectId, jobId);
    if (!active || active.jobId !== jobId) {
      if (!durable || durable.characterId !== characterId) throw new Error('This image job is not active for the project character.');
      const lineage = {styleBibleHash: durable.styleBibleHash, styleReferenceImageIds: durable.styleReferenceImageIds};
      if (durable.status === 'completed' && durable.assetId) {
        const asset = await getGeneratedAssetStore().get(durable.assetId);
        if (!asset || asset.projectId !== projectId || asset.state !== 'ready') throw new Error('Completed character image asset is unavailable.');
        return NextResponse.json({jobId, characterId, lineage, status: 'completed', ...previewPayload(projectId, {assetId: asset.id, contentSha256: asset.contentSha256})});
      }
      active = {jobId, characterId, lineage, requestHash: durable.requestHash};
      activeProjects.set(projectId, active);
    }
    if (active.characterId !== characterId) throw new Error('This image job is not active for the project character.');
    const job = await getHiggsfieldGenerationJob(jobId);
    if (job.job_type && job.job_type !== 'nano_banana_2_lite') throw new Error('Unexpected Higgsfield model.');
    const normalizedStatus = job.status.toLowerCase();
    if (normalizedStatus !== 'completed') {
      if (['failed', 'error', 'cancelled', 'canceled'].includes(normalizedStatus)) {
        if (durable) await repository.markFailed(durable.requestKey, `Provider finished with status ${normalizedStatus}.`);
        activeProjects.delete(projectId);
      }
      return NextResponse.json({jobId, status: normalizedStatus});
    }
    const resultUrl = job.result_url ?? job.min_result_url;
    if (!resultUrl) throw new Error('Completed Higgsfield image has no result URL.');
    const ingested = await ingestHiggsfieldCharacterImage({
      projectId,
      jobId: active.jobId,
      resultUrl,
      assetStore: getGeneratedAssetStore(),
      styleLineage: active.lineage,
    });
    ingestedJobs.set(jobId, {projectId, characterId, lineage: active.lineage, ...ingested});
    if (durable) await repository.markCompleted(durable.requestKey, ingested.assetId);
    activeProjects.delete(projectId);
    return NextResponse.json({jobId, characterId, lineage: active.lineage, status: 'completed', ...previewPayload(projectId, ingested)});
  } catch (error) {
    console.error('Higgsfield character image lookup failed.', {name: error instanceof Error ? error.name : 'UnknownError'});
    return NextResponse.json({error: '캐릭터 이미지 결과를 확인하지 못했습니다.', code: 'IMAGE_STATUS_FAILED'}, {status: 400});
  }
}
