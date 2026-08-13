import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';

vi.mock('server-only', () => ({}));

const submit = vi.fn();
const guardedSubmit = vi.fn();
const getAccountStatus = vi.fn();

vi.mock('@/app/lib/higgsfield/generate.server', () => ({
  submitHiggsfieldSeedanceJob: submit,
  getHiggsfieldAccountStatus: getAccountStatus,
}));
vi.mock('@/app/lib/higgsfield/submission-guard.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/lib/higgsfield/submission-guard.server')>();
  return {
    ...actual,
    createHiggsfieldSubmissionGuard: () => guardedSubmit,
  };
});

const requestBody = {
  projectId: 'temporary-project',
  approvalSignature: 'owner-approved-temporary-test',
  request: {
    prompt: '화면에 글자나 로고가 없는 자연광 제품 영상',
    mode: 't2v',
    duration: 4,
    aspect_ratio: '16:9',
    resolution: '480p',
    generate_audio: false,
  },
};

const makeRequest = (body: unknown = requestBody, headers: Record<string, string> = {}) => new NextRequest('http://localhost/api/higgsfield/generate', {
  method: 'POST',
  headers: {
    authorization: 'Bearer test-agent',
    'x-clipjs-approval-token': 'test-owner',
    'content-type': 'application/json',
    ...headers,
  },
  body: JSON.stringify(body),
});

describe('temporary Higgsfield CLI generation route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('CLIPJS_AGENT_TOKEN', 'test-agent');
    vi.stubEnv('CLIPJS_APPROVAL_TOKEN', 'test-owner');
    vi.stubEnv('CLIPJS_HIGGSFIELD_TEMP_SUBMIT_ENABLED', 'false');
    guardedSubmit.mockResolvedValue({job: {id: 'higgsfield-job-1'}, reused: false});
    getAccountStatus.mockResolvedValue({credits: 46.19, subscription_plan_type: 'ultra'});
  });

  afterEach(() => vi.unstubAllEnvs());

  it('reports sanitized CLI readiness without creating a generation job', async () => {
    vi.stubEnv('CLIPJS_HIGGSFIELD_TEMP_SUBMIT_ENABLED', 'true');
    const {GET} = await import('./route');
    const response = await GET(new NextRequest('http://localhost/api/higgsfield/generate', {
      headers: {authorization: 'Bearer test-agent'},
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({enabled: true, credits: 46.19, plan: 'ultra'});
    expect(getAccountStatus).toHaveBeenCalledOnce();
    expect(guardedSubmit).not.toHaveBeenCalled();
  });

  it('fails closed unless temporary Higgsfield submission is explicitly enabled', async () => {
    const {POST} = await import('./route');
    const response = await POST(makeRequest());
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({code: 'TEMP_PROVIDER_DISABLED'});
    expect(guardedSubmit).not.toHaveBeenCalled();
  });

  it('requires both agent and owner approval credentials', async () => {
    vi.stubEnv('CLIPJS_HIGGSFIELD_TEMP_SUBMIT_ENABLED', 'true');
    const {POST} = await import('./route');
    const response = await POST(makeRequest(requestBody, {authorization: 'Bearer wrong'}));
    expect(response.status).toBe(401);
    expect(guardedSubmit).not.toHaveBeenCalled();
  });

  it('validates and sends one idempotency-guarded CLI request when explicitly enabled', async () => {
    vi.stubEnv('CLIPJS_HIGGSFIELD_TEMP_SUBMIT_ENABLED', 'true');
    const {POST} = await import('./route');
    const response = await POST(makeRequest());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({job: {id: 'higgsfield-job-1'}, reused: false});
    expect(guardedSubmit).toHaveBeenCalledOnce();
    expect(guardedSubmit.mock.calls[0]?.[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(guardedSubmit.mock.calls[0]?.[1]).toEqual(requestBody.request);
  });

  it('rejects malformed generation parameters before the CLI boundary', async () => {
    vi.stubEnv('CLIPJS_HIGGSFIELD_TEMP_SUBMIT_ENABLED', 'true');
    const {POST} = await import('./route');
    const response = await POST(makeRequest({...requestBody, request: {...requestBody.request, duration: 3}}));
    expect(response.status).toBe(400);
    expect(guardedSubmit).not.toHaveBeenCalled();
  });
});
