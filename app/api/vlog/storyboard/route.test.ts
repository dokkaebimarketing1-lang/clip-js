import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {sha256} from '@/app/lib/workflow/hash';
import {createFilesystemStoryboardJobRepository, type StoryboardJobRepository} from '@/app/lib/storyboard-jobs/storyboard-job-repository.server';

const mocks = vi.hoisted(() => ({
  getAsset: vi.fn(),
  compose: vi.fn(),
  repository: undefined as unknown as StoryboardJobRepository,
}));

vi.mock('@/app/lib/generation/runtime.server', () => ({
  getGeneratedAssetStore: () => ({get: mocks.getAsset}),
}));
vi.mock('@/app/lib/generation/planning-runtime.server', () => ({
  getConfiguredPlanningProvider: () => ({provider: 'rules', compose: mocks.compose}),
}));
vi.mock('@/app/lib/storyboard-jobs/runtime.server', () => ({
  getStoryboardJobRepository: () => mocks.repository,
}));

import {assertLocalSingleUserDeployment, GET, POST} from './route';

const roots: string[] = [];
let styleBibleHash = '';

const brief = {
  subject: '강아지 초코와 다람쥐 다람이',
  action: '함께 도토리를 찾는다',
  durationSeconds: 20 as const,
  tone: '따뜻한 숲속 모험',
  greetingLine: '같이 찾자!',
};
const styleBible = {visualMedium: 'photo', realism: 'natural', renderLanguage: 'cinematic photo', proportionRules: 'natural anatomy', lighting: 'soft studio', lensAndDepth: '50mm', background: 'neutral seamless', textureAndColor: 'real fur and restrained color', negativeConstraints: ['no cartoon']};
const characters = [
  {id: 'CHAR01', name: '초코', breed: '강아지', palette: {dominant: '#ccaa88', secondary: '#886644', accent: '#ffffff'}, visualTags: ['활발함'], referenceImageId: `ga_${'a'.repeat(32)}`, styleReferenceImageIds: [] as string[], get referenceStyleHash() { return styleBibleHash; }},
  {id: 'CHAR02', name: '다람이', breed: '다람쥐', palette: {dominant: '#bb7744', secondary: '#eebb88', accent: '#445522'}, visualTags: ['민첩함'], referenceImageId: `ga_${'b'.repeat(32)}`, styleReferenceImageIds: [`ga_${'a'.repeat(32)}`], get referenceStyleHash() { return styleBibleHash; }},
];

beforeEach(async () => {
  styleBibleHash = await sha256(styleBible);
  const root = mkdtempSync(join(tmpdir(), 'clipjs-storyboard-route-'));
  roots.push(root);
  mocks.repository = createFilesystemStoryboardJobRepository({rootDirectory: root});
  mocks.compose.mockReset();
  mocks.compose.mockResolvedValue({
    storyboard: {
      version: 'storyboard-v2', title: '도토리 모험', noBgm: true,
      cuts: [{id: 'CUT01', title: '첫 장면', absoluteStartSeconds: 0, absoluteEndSeconds: 20, shots: [{id: 'S1', startSeconds: 0, endSeconds: 20, startFrame: '시작', endFrame: '끝', camera: '고정', action: '찾는다', dialogue: '같이 찾자!', sfx: '바람'}]}],
    },
  });
  mocks.getAsset.mockImplementation(async (assetId: string) => ({
    id: assetId,
    projectId: 'project-a',
    state: 'ready',
    assetKind: 'managed-media',
    mimeType: 'image/png',
    ...(assetId === `ga_${'a'.repeat(32)}` ? {styleLineage: {styleBibleHash, styleReferenceImageIds: []}} : {}),
    ...(assetId === `ga_${'b'.repeat(32)}` ? {styleLineage: {styleBibleHash, styleReferenceImageIds: [`ga_${'a'.repeat(32)}`]}} : {}),
  }));
});

afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, {recursive: true, force: true}));
  vi.clearAllMocks();
});

const body = (characterSheets: unknown = characters) => ({
  projectId: 'project-a',
  sentence: '강아지 초코와 다람쥐 다람이가 함께 도토리를 찾는 20초 영상',
  interviewBrief: brief,
  styleBible,
  styleBibleHash,
  characterSheets,
});
const post = (characterSheets?: unknown) => POST(new Request('http://localhost/api/vlog/storyboard', {
  method: 'POST',
  headers: {'content-type': 'application/json', origin: 'http://localhost', 'sec-fetch-site': 'same-origin'},
  body: JSON.stringify(body(characterSheets)),
}));
const get = (projectId: string, jobId?: string) => GET(new Request(`http://localhost/api/vlog/storyboard?projectId=${encodeURIComponent(projectId)}${jobId ? `&jobId=${jobId}` : ''}`, {
  headers: {'sec-fetch-site': 'same-origin'},
}));
const run = (projectId: string, jobId: string) => POST(new Request('http://localhost/api/vlog/storyboard', {
  method: 'POST',
  headers: {'content-type': 'application/json', origin: 'http://localhost', 'sec-fetch-site': 'same-origin'},
  body: JSON.stringify({action: 'run', projectId, jobId}),
}));

describe('durable storyboard jobs', () => {
  it('POST는 provider를 호출하지 않고 durable job만 enqueue한다', async () => {
    const response = await post();
    expect(response.status).toBe(202);
    const data = await response.json();
    expect(data).toMatchObject({stage: 'storyboard-job', created: true, status: 'queued', projectId: 'project-a'});
    expect(data.jobId).toMatch(/^sj_[a-f0-9]{64}$/);
    expect(mocks.compose).not.toHaveBeenCalled();
  });

  it('동일 canonical 입력 POST는 같은 job을 재사용한다', async () => {
    const first = await (await post()).json();
    const secondResponse = await post();
    const second = await secondResponse.json();
    expect(secondResponse.status).toBe(202);
    expect(second).toMatchObject({created: false, jobId: first.jobId});
  });

  it('GET은 조회만 하고 명시적 run POST가 queued job을 실행해 완료 결과를 저장한다', async () => {
    const queued = await (await post()).json();
    expect(await (await get('project-a', queued.jobId)).json()).toMatchObject({status: 'queued'});
    expect(mocks.compose).not.toHaveBeenCalled();
    const response = await run('project-a', queued.jobId);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('completed');
    expect(data.storyboard.characterReferenceIds).toEqual([`ga_${'a'.repeat(32)}`, `ga_${'b'.repeat(32)}`]);
    expect(data.storyboard.cuts[0].characterIds).toEqual(['CHAR01', 'CHAR02']);
    expect(data.lease).toBeUndefined();
    expect(mocks.compose).toHaveBeenCalledTimes(1);
    expect(await mocks.repository.get(queued.jobId)).toMatchObject({status: 'completed'});
  });

  it('만료된 processing lease는 자동 재실행하지 않고 fail-closed 처리한다', async () => {
    const queued = await (await post()).json();
    const claimed = await mocks.repository.claim(
      queued.jobId,
      'interrupted-worker',
      new Date(Date.now() - 10_000),
      1_000,
    );
    expect(claimed?.status).toBe('processing');
    const response = await run('project-a', queued.jobId);
    expect(await response.json()).toMatchObject({status: 'failed'});
    expect(mocks.compose).not.toHaveBeenCalled();
  });

  it('project discovery GET은 queued job을 찾기만 하고 provider를 자동 실행하지 않는다', async () => {
    const queued = await (await post()).json();
    const response = await GET(new Request('http://localhost/api/vlog/storyboard?projectId=project-a', {
      headers: {'sec-fetch-site': 'same-origin'},
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({jobId: queued.jobId, status: 'queued'});
    expect(mocks.compose).not.toHaveBeenCalled();
  });

  it('실패 job은 조회로 재실행하지 않고 명시적 POST 뒤에만 다시 queued 된다', async () => {
    const queued = await (await post()).json();
    mocks.compose.mockRejectedValueOnce(new Error('provider unavailable'));
    expect(await (await run('project-a', queued.jobId)).json()).toMatchObject({status: 'failed'});
    expect(mocks.compose).toHaveBeenCalledTimes(1);

    const discovery = await GET(new Request('http://localhost/api/vlog/storyboard?projectId=project-a', {
      headers: {'sec-fetch-site': 'same-origin'},
    }));
    expect(await discovery.json()).toMatchObject({status: 'failed'});
    expect(mocks.compose).toHaveBeenCalledTimes(1);

    const retried = await post();
    expect(await retried.json()).toMatchObject({jobId: queued.jobId, status: 'queued'});
    expect(await (await run('project-a', queued.jobId)).json()).toMatchObject({status: 'completed'});
    expect(mocks.compose).toHaveBeenCalledTimes(2);
  });

  it('다른 projectId로 job을 조회할 수 없다', async () => {
    const queued = await (await post()).json();
    const response = await get('project-b', queued.jobId);
    expect(response.status).toBe(404);
    expect(mocks.compose).not.toHaveBeenCalled();
  });

  it('모든 캐릭터 managed reference가 준비되기 전에는 enqueue하지 않는다', async () => {
    const response = await post([{...characters[0], referenceImageId: undefined}, characters[1]]);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({code: 'CHARACTER_REFERENCES_REQUIRED'});
  });

  it('로컬 단일 사용자 경계를 강제하고 production opt-in 없이는 fail-closed한다', () => {
    expect(() => assertLocalSingleUserDeployment(
      new Request('https://clipjs.example/api/vlog/storyboard', {headers: {host: 'clipjs.example'}}),
      {nodeEnv: 'development'},
    )).toThrow('local single-user');
    expect(() => assertLocalSingleUserDeployment(
      new Request('http://localhost/api/vlog/storyboard', {headers: {'x-forwarded-host': 'clipjs.example'}}),
      {nodeEnv: 'development'},
    )).toThrow('local single-user');
    expect(() => assertLocalSingleUserDeployment(
      new Request('http://localhost/api/vlog/storyboard'),
      {nodeEnv: 'production'},
    )).toThrow('CLIPJS_STORYBOARD_LOCAL_SINGLE_USER');
    expect(() => assertLocalSingleUserDeployment(
      new Request('http://127.0.0.1/api/vlog/storyboard'),
      {nodeEnv: 'production', localMode: 'true'},
    )).not.toThrow();
  });

  it('cross-site POST와 GET을 차단한다', async () => {
    const crossPost = await POST(new Request('http://localhost/api/vlog/storyboard', {
      method: 'POST',
      headers: {'content-type': 'application/json', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site'},
      body: JSON.stringify(body()),
    }));
    const crossGet = await GET(new Request('http://localhost/api/vlog/storyboard?projectId=project-a', {
      headers: {origin: 'https://evil.example', 'sec-fetch-site': 'cross-site'},
    }));
    expect(crossPost.status).toBe(400);
    expect(crossGet.status).toBe(400);
  });
});
