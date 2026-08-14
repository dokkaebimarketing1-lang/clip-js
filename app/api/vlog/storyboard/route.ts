import {NextResponse} from 'next/server';
import {z} from 'zod';
import {getStoryboardJobRepository} from '@/app/lib/storyboard-jobs/runtime.server';
import {assertStoryboardInputReady, StoryboardInputNotReadyError, runStoryboardJob} from '@/app/lib/storyboard-jobs/storyboard-job-runner.server';
import {storyboardJobInputSchema, type StoryboardJobRecord} from '@/app/lib/storyboard-jobs/storyboard-job-schema';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_BODY_BYTES = 64 * 1024;
const JOB_ID_PATTERN = /^sj_[a-f0-9]{64}$/;

export const assertLocalSingleUserDeployment = (
  request: Request,
  config: {nodeEnv?: string; localMode?: string} = {
    nodeEnv: process.env.NODE_ENV,
    localMode: process.env.CLIPJS_STORYBOARD_LOCAL_SINGLE_USER,
  },
) => {
  const hosts = [
    new URL(request.url).host,
    request.headers.get('host'),
    ...(request.headers.get('x-forwarded-host')?.split(',') ?? []),
  ].map((value) => value?.trim()).filter((value): value is string => Boolean(value));
  const isLoopback = (host: string) => {
    try {
      return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(`http://${host}`).hostname.toLowerCase());
    } catch {
      return false;
    }
  };
  if (hosts.length === 0 || !hosts.every(isLoopback)) {
    throw new Error('Storyboard jobs are available only in local single-user mode.');
  }
  if (config.nodeEnv === 'production' && config.localMode !== 'true') {
    throw new Error('CLIPJS_STORYBOARD_LOCAL_SINGLE_USER=true is required in production.');
  }
};

const assertPostOrigin = (request: Request) => {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite !== 'same-origin' || origin !== new URL(request.url).origin) {
    throw new Error('Browser same-origin context is required.');
  }
};

const assertGetOrigin = (request: Request) => {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite !== 'same-origin' || (origin && origin !== new URL(request.url).origin)) {
    throw new Error('Browser same-origin context is required.');
  }
};

const readBody = async (request: Request): Promise<unknown> => {
  const type = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (!type.startsWith('application/json')) throw new Error('JSON required.');
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new Error('Request too large.');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new Error('Request too large.');
  return JSON.parse(text);
};

const publicRecord = (record: StoryboardJobRecord) => ({
  jobId: record.jobId,
  projectId: record.projectId,
  requestHash: record.requestHash,
  status: record.status,
  input: record.input,
  attempt: record.attempt,
  ...(record.storyboard ? {storyboard: record.storyboard} : {}),
  ...(record.error ? {error: record.error} : {}),
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const json = (body: unknown, init?: ResponseInit) => NextResponse.json(body, {
  ...init,
  headers: {...init?.headers, 'cache-control': 'no-store'},
});

const runJobSchema = z.object({
  action: z.literal('run'),
  projectId: z.string().min(1).max(128),
  jobId: z.string().regex(JOB_ID_PATTERN),
}).strict();

export const POST = async (request: Request) => {
  let raw: unknown;
  try {
    assertLocalSingleUserDeployment(request);
    assertPostOrigin(request);
    raw = await readBody(request);
  } catch {
    return json({error: '잘못된 요청입니다.', code: 'INVALID_REQUEST'}, {status: 400});
  }

  const runRequest = runJobSchema.safeParse(raw);
  if (runRequest.success) {
    try {
      const repository = getStoryboardJobRepository();
      const located = await repository.get(runRequest.data.jobId);
      if (!located || located.projectId !== runRequest.data.projectId) {
        return json({error: '스토리보드 작업을 찾을 수 없습니다.', code: 'STORYBOARD_JOB_NOT_FOUND'}, {status: 404});
      }
      const record = located.status === 'queued' || located.status === 'processing'
        ? await runStoryboardJob(located.jobId) ?? located
        : located;
      return json({stage: 'storyboard-job', ...publicRecord(record)});
    } catch (error) {
      console.error('Storyboard job execution failed.', {name: error instanceof Error ? error.name : 'UnknownError'});
      return json({error: '스토리보드 작업을 실행하지 못했습니다.', code: 'STORYBOARD_JOB_EXECUTION_FAILED'}, {status: 503});
    }
  }

  const parsed = storyboardJobInputSchema.safeParse(raw);
  if (!parsed.success) {
    return json({
      error: '모든 캐릭터 기준 이미지를 준비한 뒤 스토리보드를 생성하세요.',
      code: 'CHARACTER_REFERENCES_REQUIRED',
    }, {status: 409});
  }

  try {
    await assertStoryboardInputReady(parsed.data);
    const repository = getStoryboardJobRepository();
    const result = await repository.createOrGet(parsed.data);
    const record = result.record.status === 'failed'
      ? await repository.requeueFailed(result.record.jobId)
      : result.record;
    return json({stage: 'storyboard-job', created: result.created, ...publicRecord(record)}, {
      status: record.status === 'completed' ? 200 : 202,
    });
  } catch (error) {
    if (error instanceof StoryboardInputNotReadyError) {
      return json({error: error.message, code: error.code}, {status: 409});
    }
    console.error('Storyboard job enqueue failed.', {name: error instanceof Error ? error.name : 'UnknownError'});
    return json({error: '스토리보드 작업을 저장하지 못했습니다.', code: 'STORYBOARD_JOB_STORE_FAILED'}, {status: 503});
  }
};

const querySchema = z.object({
  projectId: z.string().min(1).max(128),
  jobId: z.string().regex(JOB_ID_PATTERN).optional(),
});

export const GET = async (request: Request) => {
  try {
    assertLocalSingleUserDeployment(request);
    assertGetOrigin(request);
  } catch {
    return json({error: '잘못된 요청입니다.', code: 'INVALID_REQUEST'}, {status: 400});
  }
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    projectId: url.searchParams.get('projectId'),
    jobId: url.searchParams.get('jobId') || undefined,
  });
  if (!parsed.success) return json({error: '잘못된 요청입니다.', code: 'INVALID_REQUEST'}, {status: 400});

  try {
    const repository = getStoryboardJobRepository();
    const located = parsed.data.jobId
      ? await repository.get(parsed.data.jobId)
      : await repository.latestForProject(parsed.data.projectId);
    if (!located || located.projectId !== parsed.data.projectId) {
      return json({error: '스토리보드 작업을 찾을 수 없습니다.', code: 'STORYBOARD_JOB_NOT_FOUND'}, {status: 404});
    }
    const record = located;
    return json({stage: 'storyboard-job', ...publicRecord(record)});
  } catch (error) {
    console.error('Storyboard job lookup failed.', {name: error instanceof Error ? error.name : 'UnknownError'});
    return json({error: '스토리보드 작업 상태를 불러오지 못했습니다.', code: 'STORYBOARD_JOB_LOOKUP_FAILED'}, {status: 503});
  }
};
