import 'fake-indexeddb/auto';
import {beforeAll, describe, expect, it, vi} from 'vitest';
import {commitProjectMutation, getProject, storeProject} from '@/app/store';
import projectReducer, {acknowledgeProjectRevision, initialState} from '@/app/store/slices/projectSlice';
import {interviewBriefSchema, storyboardSchema, styleBibleSchema} from '@/app/lib/workflow/schema';
import {applyCompletedStoryboardJob, StaleStoryboardJobError} from './storyboard-job-client';
import {storyboardJobInputSchema} from './storyboard-job-schema';

beforeAll(() => {
  vi.stubGlobal('window', globalThis);
});

const brief = interviewBriefSchema.parse({subject: '초코', action: '숲길을 걷는다', durationSeconds: 20, tone: '따뜻함', greetingLine: '같이 가자'});
const styleBible = styleBibleSchema.parse({visualMedium: '3D animation', realism: 'stylized', renderLanguage: 'cinematic', proportionRules: 'consistent', lighting: 'warm daylight', lensAndDepth: '35mm', background: 'forest', textureAndColor: 'soft', negativeConstraints: ['no text']});
const sheet = {id: 'CHAR01', name: '초코', palette: {dominant: '#ffffff', secondary: '#dddddd', accent: '#111111'}, visualTags: ['강아지'], referenceImageId: `ga_${'1'.repeat(32)}`, referenceStyleHash: 'a'.repeat(64), styleReferenceImageIds: []};
const input = storyboardJobInputSchema.parse({projectId: 'project-a', sentence: '초코. 숲길을 걷는다.', interviewBrief: brief, styleBible, styleBibleHash: 'a'.repeat(64), characterSheets: [sheet]});
const storyboard = storyboardSchema.parse({version: 'storyboard-v2', title: '콘티', noBgm: true, styleBibleHash: 'a'.repeat(64), characterReferenceIds: [sheet.referenceImageId], cuts: [{id: 'CUT01', title: '첫 장면', absoluteStartSeconds: 0, absoluteEndSeconds: 20, characterIds: ['CHAR01'], shots: [{id: 'S1', startSeconds: 0, endSeconds: 20, startFrame: '시작', endFrame: '끝', camera: '고정', action: '걷는다', dialogue: '같이 가자', sfx: '바람'}]}]});
const project = () => ({...initialState, id: 'project-a', workflow: {...initialState.workflow, interviewBrief: brief, styleBible, styleBibleHash: 'a'.repeat(64), characterSheet: sheet, characterSheets: [sheet]}});
const response = () => ({stage: 'storyboard-job', jobId: `sj_${'b'.repeat(64)}`, projectId: 'project-a', requestHash: 'b'.repeat(64), status: 'completed', input, attempt: 1, storyboard, createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:10.000Z'});

describe('durable storyboard job client CAS', () => {
  it('현재 입력과 exact-match하는 completed job만 project에 설치한다', () => {
    expect(applyCompletedStoryboardJob(project(), response()).workflow.storyboard).toEqual(storyboard);
  });

  it('브리프가 바뀐 project에는 완료된 과거 job을 설치하지 않는다', () => {
    const stale = project();
    stale.workflow.interviewBrief = {...brief, action: '바뀐 행동'};
    expect(() => applyCompletedStoryboardJob(stale, response())).toThrow(StaleStoryboardJobError);
    expect(stale.workflow.storyboard).toBeUndefined();
  });

  it('다른 프로젝트 job을 설치하지 않는다', () => {
    expect(() => applyCompletedStoryboardJob({...project(), id: 'project-b'}, response())).toThrow(StaleStoryboardJobError);
  });

  it('durable revision ack는 최신 메모리 편집을 보존하고 다른 프로젝트 ack를 무시한다', () => {
    const edited = {...project(), projectName: '저장 중 바꾼 최신 이름', revision: 2};
    const acknowledged = projectReducer(edited, acknowledgeProjectRevision({projectId: edited.id, revision: 3}));
    expect(acknowledged).toMatchObject({projectName: '저장 중 바꾼 최신 이름', revision: 3});

    const foreign = projectReducer(acknowledged, acknowledgeProjectRevision({projectId: 'project-b', revision: 9}));
    expect(foreign).toBe(acknowledged);
  });

  it('완료 job을 revision CAS로 저장하면 reload에서도 storyboard가 복원된다', async () => {
    const id = `storyboard-job-${crypto.randomUUID()}`;
    const base = {...project(), id, projectName: '스토리보드 복구 테스트', revision: 0};
    const completed = response();
    completed.projectId = id;
    completed.input = storyboardJobInputSchema.parse({...input, projectId: id});
    await storeProject(base);

    const committed = await commitProjectMutation(id, 0, (current) => applyCompletedStoryboardJob(current, completed));
    const restored = await getProject(id);

    expect(committed.revision).toBe(1);
    expect(restored?.workflow.storyboard).toEqual(storyboard);
    expect(restored?.revision).toBe(1);
  });
});
