import {NextRequest, NextResponse} from 'next/server';
import {createAssetCapability} from '@/app/lib/assets/asset-capability.server';
import {ingestHiggsfieldCharacterImage} from '@/app/lib/assets/secure-higgsfield-image-ingest.server';
import {getGeneratedAssetStore} from '@/app/lib/generation/runtime.server';
import {getHiggsfieldGenerationJob, parseHiggsfieldSubmittedJobId, submitHiggsfieldCharacterImageJob} from '@/app/lib/higgsfield/generate.server';
import {readLimitedJson} from '@/app/lib/security/request-body';

export const runtime = 'nodejs';
export const maxDuration = 60;

const UUID = /^[a-f0-9-]{36}$/i;
type ImageLineage = {styleBibleHash: string; styleReferenceImageIds: string[]};
const activeProjects = new Map<string, {jobId: string; characterId: string; lineage: ImageLineage}>();
const ingestedJobs = new Map<string, {projectId: string; characterId: string; assetId: string; contentSha256: string; lineage: ImageLineage}>();

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
    assertSameOrigin(request);
    ({projectId} = await context.params);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(projectId)) throw new Error('Invalid project ID.');
    if (process.env.CLIPJS_HIGGSFIELD_TEMP_SUBMIT_ENABLED !== 'true') {
      return NextResponse.json({error: 'Higgsfield image generation is disabled.', code: 'PROVIDER_DISABLED'}, {status: 410});
    }
    const body = await readLimitedJson(request) as Record<string, unknown>;
    const characterId = typeof body.characterId === 'string' ? body.characterId : '';
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    const styleBibleHash = typeof body.styleBibleHash === 'string' ? body.styleBibleHash : '';
    const styleReferenceImageIds = Array.isArray(body.styleReferenceImageIds) ? body.styleReferenceImageIds.filter((id): id is string => typeof id === 'string') : [];
    if (!/^CHAR\d{2}$/.test(characterId) || !/^[a-f0-9]{64}$/.test(styleBibleHash) || styleReferenceImageIds.length > 14
      || body.confirmCreditCost !== 1 || prompt.length < 10 || prompt.length > 4000) throw new Error('Explicit 1-credit approval, character identity, style lineage, and a valid prompt are required.');
    const assetStore = getGeneratedAssetStore();
    const referenceAssets = await Promise.all(styleReferenceImageIds.map((id) => assetStore.get(id)));
    if (referenceAssets.some((asset) => !asset || asset.projectId !== projectId || asset.state !== 'ready' || !asset.mimeType.startsWith('image/')
      || asset.styleLineage?.styleBibleHash !== styleBibleHash)) {
      throw new Error('Style reference image is unavailable, has different lineage, or belongs to another project.');
    }
    const projectAssets = await assetStore.listProject(projectId);
    const anchors = projectAssets.filter((asset) => asset.state === 'ready' && asset.mimeType.startsWith('image/')
      && asset.styleLineage?.styleBibleHash === styleBibleHash && asset.styleLineage.styleReferenceImageIds.length === 0);
    if (anchors.length > 0 && !anchors.some((anchor) => styleReferenceImageIds.includes(anchor.id))) {
      throw new Error('A later character image must reference the approved project style anchor.');
    }
    const imageReferencePaths = styleReferenceImageIds.map((id) => assetStore.resolveLocalPath(id));
    const lineage = {styleBibleHash, styleReferenceImageIds};
    const active = activeProjects.get(projectId);
    if (active) {
      if (active.characterId !== characterId) {
        return NextResponse.json({error: '다른 캐릭터 이미지 생성이 처리 중입니다.', code: 'ANOTHER_CHARACTER_ACTIVE'}, {status: 409});
      }
      if (active.lineage.styleBibleHash !== styleBibleHash || active.lineage.styleReferenceImageIds.join(',') !== styleReferenceImageIds.join(',')) throw new Error('Active image job lineage does not match.');
      return NextResponse.json({jobId: active.jobId, characterId, lineage, status: 'queued', model: 'nano_banana_2_lite', credits: 1, reused: true}, {status: 202});
    }
    const result = await submitHiggsfieldCharacterImageJob({prompt, imageReferencePaths, aspect_ratio: '16:9', resolution: '1k', thinking: 'HIGH'});
    const jobId = parseHiggsfieldSubmittedJobId(result);
    if (!jobId) throw new Error('Higgsfield did not return a valid job ID.');
    activeProjects.set(projectId, {jobId, characterId, lineage});
    return NextResponse.json({jobId, characterId, lineage, status: 'queued', model: 'nano_banana_2_lite', credits: 1, reused: false}, {status: 202});
  } catch (error) {
    console.error('Higgsfield character image submission rejected.', {name: error instanceof Error ? error.name : 'UnknownError'});
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
    const active = activeProjects.get(projectId);
    if (active?.jobId !== jobId || active.characterId !== characterId) throw new Error('This image job is not active for the project character.');
    const job = await getHiggsfieldGenerationJob(jobId);
    if (job.job_type && job.job_type !== 'nano_banana_2_lite') throw new Error('Unexpected Higgsfield model.');
    if (job.status !== 'completed') {
      if (['failed', 'error', 'cancelled'].includes(job.status.toLowerCase())) activeProjects.delete(projectId);
      return NextResponse.json({jobId, status: job.status});
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
    activeProjects.delete(projectId);
    return NextResponse.json({jobId, characterId, lineage: active.lineage, status: 'completed', ...previewPayload(projectId, ingested)});
  } catch (error) {
    console.error('Higgsfield character image lookup failed.', {name: error instanceof Error ? error.name : 'UnknownError'});
    return NextResponse.json({error: '캐릭터 이미지 결과를 확인하지 못했습니다.', code: 'IMAGE_STATUS_FAILED'}, {status: 400});
  }
}
