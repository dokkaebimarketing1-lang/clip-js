import {describe, expect, it} from 'vitest';
import projectReducer, {initialState, installPlanningIfCurrent} from '@/app/store/slices/projectSlice';
import {preparePlanningInstallCommand} from './planning-apply';
import {buildDefaultSeedanceMasterSettings} from './seedance-master';

const planningResponse = {
  interviewBrief: {subject: '새 기획', action: '숲을 걷는다', durationSeconds: 20, tone: '밝음', greetingLine: '가자!'},
  styleBible: {visualMedium: '3D animation', realism: 'stylized', renderLanguage: 'cinematic', proportionRules: 'consistent', lighting: 'warm daylight', lensAndDepth: '35mm', background: 'forest', textureAndColor: 'soft', negativeConstraints: ['no text']},
  styleBibleHash: 'a'.repeat(64),
  characterSheets: [{id: 'CHAR01', name: '초코', visualTags: ['강아지']}],
  seedanceMaster: buildDefaultSeedanceMasterSettings(),
};

const command = () => preparePlanningInstallCommand({expectedWorkflow: initialState.workflow, ...planningResponse});

describe('planning response compare-and-set', () => {
  it('compose 대기 중 workflow가 바뀌면 stale 기획을 설치하지 않고 최신 상태를 보존한다', () => {
    const changed = {
      ...initialState,
      workflow: {...initialState.workflow, production: {...initialState.workflow.production, assets: [{id: 'latest', tag: '@latest', type: 'prop' as const, state: 'base' as const, descriptor: 'latest user asset', referenceUrl: 'https://example.com/latest.png', referenceHash: 'a'.repeat(64), editMode: 'original' as const, status: 'draft' as const, stressTests: []}] }},
    };
    const next = projectReducer(changed, installPlanningIfCurrent(command()));
    expect(next.workflow.interviewBrief).toBeUndefined();
    expect(next.workflow.production.assets[0]?.id).toBe('latest');
  });

  it('요청 시작 workflow가 최신 상태와 같을 때만 새 기획을 설치한다', () => {
    const next = projectReducer(initialState, installPlanningIfCurrent(command()));
    expect(next.workflow.interviewBrief?.subject).toBe('새 기획');
    expect(next.workflow.planningStatus).toBe('draft');
    expect(next.workflow.storyboard).toBeUndefined();
  });
});
