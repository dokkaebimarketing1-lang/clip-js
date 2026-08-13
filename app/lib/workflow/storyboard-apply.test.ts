import {describe, expect, it} from 'vitest';
import projectReducer, {initialState, installStoryboardIfCurrent} from '@/app/store/slices/projectSlice';
import {prepareStoryboardInstallCommand} from './storyboard-apply';
import {characterSheetSchema, interviewBriefSchema, storyboardSchema, styleBibleSchema} from './schema';

const brief = interviewBriefSchema.parse({subject: '초코의 여행', action: '숲길을 걷는다', durationSeconds: 20, tone: '밝음', greetingLine: '같이 가자!'});
const styleBible = styleBibleSchema.parse({visualMedium: '3D animation', realism: 'stylized', renderLanguage: 'cinematic', proportionRules: 'consistent', lighting: 'warm daylight', lensAndDepth: '35mm', background: 'forest', textureAndColor: 'soft', negativeConstraints: ['no text']});
const sheet = characterSheetSchema.parse({id: 'CHAR01', name: '초코', visualTags: ['강아지'], referenceImageId: 'asset-1', referenceStyleHash: 'a'.repeat(64), styleReferenceImageIds: []});
const storyboard = storyboardSchema.parse({version: 'storyboard-v2', title: '콘티', noBgm: true, styleBibleHash: 'a'.repeat(64), characterReferenceIds: ['asset-1'], cuts: [{id: 'CUT01', title: '첫 장면', absoluteStartSeconds: 0, absoluteEndSeconds: 4, characterIds: ['CHAR01'], shots: [{id: 'S1', startSeconds: 0, endSeconds: 4, startFrame: '시작', endFrame: '끝', camera: '고정', action: '걷는다', dialogue: '가자', sfx: '바람'}]}]});

const currentState = () => ({...initialState, workflow: {...initialState.workflow, interviewBrief: brief, styleBible, styleBibleHash: 'a'.repeat(64), characterSheet: sheet, characterSheets: [sheet]}});
const command = () => prepareStoryboardInstallCommand({interviewBrief: brief, styleBible, styleBibleHash: 'a'.repeat(64), characterSheets: [sheet], storyboard});

describe('storyboard response compare-and-set', () => {
  it('요청 뒤 브리프가 바뀌면 stale storyboard를 설치하지 않는다', () => {
    const current = currentState();
    const changed = {...current, workflow: {...current.workflow, interviewBrief: {...brief, action: '요청 중 사용자가 바꾼 장면'}}};
    const next = projectReducer(changed, installStoryboardIfCurrent(command()));
    expect(next.workflow.storyboard).toBeUndefined();
    expect(next.workflow.interviewBrief?.action).toBe('요청 중 사용자가 바꾼 장면');
  });

  it('요청 입력이 최신 상태와 같을 때만 storyboard를 설치한다', () => {
    const next = projectReducer(currentState(), installStoryboardIfCurrent(command()));
    expect(next.workflow.storyboard).toEqual(storyboard);
  });
});
