import {NextRequest, NextResponse} from 'next/server';
import {createAssetCapability} from '@/app/lib/assets/asset-capability.server';
import {ingestHiggsfieldCharacterImage} from '@/app/lib/assets/secure-higgsfield-image-ingest.server';
import {getGeneratedAssetStore} from '@/app/lib/generation/runtime.server';
import {getHiggsfieldGenerationJob, parseHiggsfieldSubmittedJobId, submitHiggsfieldCharacterImageJob} from '@/app/lib/higgsfield/generate.server';
import {readLimitedJson} from '@/app/lib/security/request-body';

export const runtime = 'nodejs';
export const maxDuration = 60;

const UUID = /^[a-f0-9-]{36}$/i;
const activeProjects = new Map<string, {jobId: string; characterId: string}>();
const ingestedJobs = new Map<string, {projectId: string; characterId: string; assetId: string; contentSha256: string}>();

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
    if (!/^CHAR\d{2}$/.test(characterId) || body.confirmCreditCost !== 1 || prompt.length < 10 || prompt.length > 4000) throw new Error('Explicit 1-credit approval, character identity, and a valid prompt are required.');
    const active = activeProjects.get(projectId);
    if (active) {
      if (active.characterId !== characterId) {
        return NextResponse.json({error: '다른 캐릭터 이미지 생성이 처리 중입니다.', code: 'ANOTHER_CHARACTER_ACTIVE'}, {status: 409});
      }
      return NextResponse.json({jobId: active.jobId, characterId, status: 'queued', model: 'nano_banana_2_lite', credits: 1, reused: true}, {status: 202});
    }
    const result = await submitHiggsfieldCharacterImageJob({prompt, aspect_ratio: '16:9', resolution: '1k', thinking: 'HIGH'});
    const jobId = parseHiggsfieldSubmittedJobId(result);
    if (!jobId) throw new Error('Higgsfield did not return a valid job ID.');
    activeProjects.set(projectId, {jobId, characterId});
    return NextResponse.json({jobId, characterId, status: 'queued', model: 'nano_banana_2_lite', credits: 1, reused: false}, {status: 202});
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
      return NextResponse.json({jobId, characterId, status: 'completed', ...previewPayload(projectId, cached)});
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
    const asset = await ingestHiggsfieldCharacterImage({projectId, jobId, resultUrl, assetStore: getGeneratedAssetStore()});
    ingestedJobs.set(jobId, {projectId, characterId, ...asset});
    activeProjects.delete(projectId);
    return NextResponse.json({jobId, characterId, status: 'completed', ...previewPayload(projectId, asset)});
  } catch (error) {
    console.error('Higgsfield character image lookup failed.', {name: error instanceof Error ? error.name : 'UnknownError'});
    return NextResponse.json({error: '캐릭터 이미지 결과를 확인하지 못했습니다.', code: 'IMAGE_STATUS_FAILED'}, {status: 400});
  }
}
