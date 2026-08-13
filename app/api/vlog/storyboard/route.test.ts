import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {POST} from './route';

const getAsset = vi.fn();
vi.mock('@/app/lib/generation/runtime.server', () => ({
  getGeneratedAssetStore: () => ({get: getAsset}),
}));

beforeEach(() => {
  vi.stubEnv('CLIPJS_PLANNING_PROVIDER', 'rules');
  getAsset.mockImplementation(async (assetId: string) => ({
    id: assetId,
    projectId: 'project-a',
    state: 'ready',
    assetKind: 'managed-media',
    mimeType: 'image/png',
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const brief = {
  subject: '강아지 초코와 다람쥐 다람이',
  action: '함께 도토리를 찾는다',
  durationSeconds: 20,
  tone: '따뜻한 숲속 모험',
  greetingLine: '같이 찾자!',
};

const characters = [
  {id: 'CHAR01', name: '초코', breed: '강아지', palette: {dominant: '#ccaa88', secondary: '#886644', accent: '#ffffff'}, visualTags: ['활발함'], referenceImageId: `ga_${'a'.repeat(32)}`},
  {id: 'CHAR02', name: '다람이', breed: '다람쥐', palette: {dominant: '#bb7744', secondary: '#eebb88', accent: '#445522'}, visualTags: ['민첩함'], referenceImageId: `ga_${'b'.repeat(32)}`},
];

const post = (characterSheets: unknown) => POST(new Request('http://localhost/api/vlog/storyboard', {
  method: 'POST',
  headers: {'content-type': 'application/json', origin: 'http://localhost', 'sec-fetch-site': 'same-origin'},
  body: JSON.stringify({projectId: 'project-a', sentence: '강아지 초코와 다람쥐 다람이가 함께 도토리를 찾는 20초 영상', interviewBrief: brief, characterSheets}),
}));

describe('storyboard generation gate', () => {
  it('rejects generation until every character has a managed reference image', async () => {
    const response = await post([{...characters[0], referenceImageId: undefined}, characters[1]]);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({code: 'CHARACTER_REFERENCES_REQUIRED'});
  });

  it('generates storyboard only after every character reference is ready', async () => {
    const response = await post(characters);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.storyboard.cuts.length).toBeGreaterThan(0);
    expect(data.storyboard.characterReferenceIds).toEqual([`ga_${'a'.repeat(32)}`, `ga_${'b'.repeat(32)}`]);
    expect(data.storyboard.cuts.every((cut: {characterIds?: string[]}) => Array.isArray(cut.characterIds))).toBe(true);
  });

  it('rejects duplicate character identities before calling the planning provider', async () => {
    const response = await post([characters[0], {...characters[1], id: 'CHAR01'}]);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({code: 'DUPLICATE_CHARACTER_ID'});
  });

  it('rejects cross-site planning requests', async () => {
    const response = await POST(new Request('http://localhost/api/vlog/storyboard', {
      method: 'POST',
      headers: {'content-type': 'application/json', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site'},
      body: JSON.stringify({projectId: 'project-a', sentence: 'test', interviewBrief: brief, characterSheets: characters}),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({code: 'INVALID_REQUEST'});
  });

  it('rejects a reference asset owned by another project', async () => {
    getAsset.mockResolvedValue({projectId: 'project-b', assetKind: 'character-reference', mimeType: 'image/png'});
    const response = await post(characters);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({code: 'CHARACTER_REFERENCE_NOT_FOUND'});
  });
});
