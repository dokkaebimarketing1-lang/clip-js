import {describe, expect, it} from 'vitest';
import projectReducer, {initialState, installCreativeApprovalIfCurrent, setPlanningStatus} from '@/app/store/slices/projectSlice';
import {approveCreative} from './approval';
import {prepareCreativeApprovalCommand} from './creative-approval-apply';
import {characterSheetSchema, interviewBriefSchema, storyboardSchema} from './schema';

const brief = interviewBriefSchema.parse({
  subject: '초코의 여행', action: '초코가 숲길을 걷는다', durationSeconds: 20,
  tone: '밝고 경쾌함', greetingLine: '같이 가자!',
});

const sheet = characterSheetSchema.parse({
  id: 'CHAR01', name: '초코', visualTags: ['강아지'], referenceImageId: 'asset-1',
  referenceStyleHash: 'a'.repeat(64), styleReferenceImageIds: [],
});

const storyboard = storyboardSchema.parse({
  version: 'storyboard-v2', title: '검수할 스토리보드', noBgm: true,
  styleBibleHash: 'a'.repeat(64), characterReferenceIds: ['asset-1'],
  cuts: [{
    id: 'CUT01', title: '첫 장면', absoluteStartSeconds: 0, absoluteEndSeconds: 4,
    characterIds: ['CHAR01'],
    shots: [{id: 'S1', startSeconds: 0, endSeconds: 4, startFrame: '시작', endFrame: '끝', camera: '고정', action: '인사한다', dialogue: '안녕', sfx: '바람'}],
  }],
});

describe('Creative approval compare-and-set', () => {
  it('사용자가 기획을 확정하면 workflow 전체를 덮지 않고 planning 상태만 변경한다', () => {
    const current = {...initialState, workflow: {...initialState.workflow, interviewBrief: brief}};
    const next = projectReducer(current, setPlanningStatus('approved'));

    expect(next.workflow.planningStatus).toBe('approved');
    expect(next.workflow.interviewBrief).toEqual(brief);
    expect(next.workflow.characterSheets).toEqual(current.workflow.characterSheets);
  });

  it('비동기 검증 뒤 storyboard가 바뀌면 dispatch 순간 stale 승인을 원자적으로 거부한다', async () => {
    const approval = await approveCreative(storyboard, 'owner', new Date('2026-08-14T00:00:00Z'), [sheet]);
    const command = await prepareCreativeApprovalCommand(storyboard, [sheet], approval);
    const changedStoryboard = storyboardSchema.parse({...storyboard, cuts: storyboard.cuts.map((cut) => ({...cut, title: '승인 중 변경된 장면'}))});
    const beforeDispatch = {
      ...initialState,
      workflow: {...initialState.workflow, characterSheet: sheet, characterSheets: [sheet], storyboard: changedStoryboard},
    };

    const next = projectReducer(beforeDispatch, installCreativeApprovalIfCurrent(command));

    expect(next.workflow.storyboard?.cuts[0]?.title).toBe('승인 중 변경된 장면');
    expect(next.workflow.creativeApproval.status).toBe('draft');
  });

  it('dispatch 순간 입력이 요청 스냅샷과 같을 때만 승인을 설치한다', async () => {
    const approval = await approveCreative(storyboard, 'owner', new Date('2026-08-14T00:00:00Z'), [sheet]);
    const command = await prepareCreativeApprovalCommand(storyboard, [sheet], approval);
    const current = {
      ...initialState,
      workflow: {...initialState.workflow, characterSheet: sheet, characterSheets: [sheet], storyboard},
    };

    const next = projectReducer(current, installCreativeApprovalIfCurrent(command));

    expect(next.workflow.creativeApproval).toEqual(approval);
    expect(next.workflow.production.shotSpecs).toHaveLength(1);
    expect(next.workflow.generationApproval.status).toBe('invalidated');
    expect(next.workflow.releaseApproval.status).toBe('invalidated');
  });
});
