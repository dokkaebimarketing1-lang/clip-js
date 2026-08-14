import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {storyboardSchema, styleBibleSchema, interviewBriefSchema} from '@/app/lib/workflow/schema';
import {
  StoryboardJobFenceError,
  computeStoryboardRequestHash,
  createFilesystemStoryboardJobRepository,
} from './storyboard-job-repository.server';
import {storyboardJobInputSchema} from './storyboard-job-schema';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, {recursive: true, force: true})));

const input = storyboardJobInputSchema.parse({
  projectId: 'project-a',
  sentence: '초코가 숲길을 걷는 20초 영상',
  interviewBrief: interviewBriefSchema.parse({subject: '초코', action: '숲길을 걷는다', durationSeconds: 20, tone: '따뜻함', greetingLine: '같이 가자'}),
  styleBible: styleBibleSchema.parse({visualMedium: '3D animation', realism: 'stylized', renderLanguage: 'cinematic', proportionRules: 'consistent', lighting: 'warm daylight', lensAndDepth: '35mm', background: 'forest', textureAndColor: 'soft', negativeConstraints: ['no text']}),
  styleBibleHash: 'a'.repeat(64),
  characterSheets: [{id: 'CHAR01', name: '초코', visualTags: ['강아지'], referenceImageId: `ga_${'1'.repeat(32)}`, referenceStyleHash: 'a'.repeat(64), styleReferenceImageIds: []}],
});
const storyboard = storyboardSchema.parse({version: 'storyboard-v2', title: '콘티', noBgm: true, styleBibleHash: 'a'.repeat(64), characterReferenceIds: [`ga_${'1'.repeat(32)}`], cuts: [{id: 'CUT01', title: '첫 장면', absoluteStartSeconds: 0, absoluteEndSeconds: 20, characterIds: ['CHAR01'], shots: [{id: 'S1', startSeconds: 0, endSeconds: 20, startFrame: '시작', endFrame: '끝', camera: '고정', action: '걷는다', dialogue: '같이 가자', sfx: '바람'}]}]});

const repository = () => {
  const root = mkdtempSync(join(tmpdir(), 'clipjs-storyboard-jobs-'));
  roots.push(root);
  return {root, repo: createFilesystemStoryboardJobRepository({rootDirectory: root})};
};

describe('filesystem storyboard job repository', () => {
  it('동일 project와 canonical 입력은 동일 job을 재사용한다', async () => {
    const {repo} = repository();
    const first = await repo.createOrGet(input, new Date('2026-08-14T00:00:00Z'));
    const second = await repo.createOrGet(structuredClone(input), new Date('2026-08-14T00:00:01Z'));
    expect(second.created).toBe(false);
    expect(second.record.jobId).toBe(first.record.jobId);
    expect(second.record.requestHash).toBe(computeStoryboardRequestHash(input));
  });

  it('유효 lease 중복 claim을 막고 만료 후 새 worker가 재개한다', async () => {
    const {repo} = repository();
    const {record} = await repo.createOrGet(input, new Date('2026-08-14T00:00:00Z'));
    const first = await repo.claim(record.jobId, 'worker-a', new Date('2026-08-14T00:00:01Z'), 60_000);
    if (!first?.lease) throw new Error('Expected first lease.');
    expect(first.lease.workerId).toBe('worker-a');
    expect(await repo.claim(record.jobId, 'worker-b', new Date('2026-08-14T00:00:30Z'), 60_000)).toBeUndefined();
    const resumed = await repo.claim(record.jobId, 'worker-b', new Date('2026-08-14T00:01:02Z'), 60_000);
    if (!resumed?.lease) throw new Error('Expected resumed lease.');
    expect(resumed.lease.workerId).toBe('worker-b');
    expect(resumed.attempt).toBe(2);
  });

  it('stale fencing token의 완료 저장을 거부한다', async () => {
    const {repo} = repository();
    const {record} = await repo.createOrGet(input, new Date('2026-08-14T00:00:00Z'));
    const first = await repo.claim(record.jobId, 'worker-a', new Date('2026-08-14T00:00:01Z'), 1_000);
    const second = await repo.claim(record.jobId, 'worker-b', new Date('2026-08-14T00:00:03Z'), 60_000);
    if (!first?.lease || !second?.lease) throw new Error('Expected fenced leases.');
    await expect(repo.complete(record.jobId, first.lease.token, storyboard)).rejects.toBeInstanceOf(StoryboardJobFenceError);
    const completed = await repo.complete(record.jobId, second.lease.token, storyboard);
    expect(completed.status).toBe('completed');
  });

  it('완료 결과를 새 repository instance에서도 복구한다', async () => {
    const {root, repo} = repository();
    const {record} = await repo.createOrGet(input);
    const claim = await repo.claim(record.jobId, 'worker-a');
    if (!claim?.lease) throw new Error('Expected completion lease.');
    await repo.complete(record.jobId, claim.lease.token, storyboard);
    const restarted = createFilesystemStoryboardJobRepository({rootDirectory: root});
    expect(await restarted.get(record.jobId)).toMatchObject({status: 'completed', storyboard});
    expect(await restarted.latestForProject('project-a')).toMatchObject({jobId: record.jobId});
  });
});
