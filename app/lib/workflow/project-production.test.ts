import {describe, expect, it} from 'vitest';
import {initialState} from '@/app/store/slices/projectSlice';
import {
  attachCutFrameAsset,
  reorderStoryboardCuts,
  selectTakeForTimeline,
  updateCutFromInstruction,
} from './project-production';

const project = () => {
  const value = structuredClone(initialState);
  value.id = 'project-p1';
  value.workflow.storyboard = {
    version: 'v1', title: 'P1', noBgm: true,
    cuts: [
      {id: 'CUT01', title: '하나', absoluteStartSeconds: 0, absoluteEndSeconds: 5, shots: [{id: 'S1', startSeconds: 0, endSeconds: 5, startFrame: '첫 프레임', endFrame: '끝 프레임', camera: 'static', action: '첫 행동', dialogue: '—', sfx: 'room'}]},
      {id: 'CUT02', title: '둘', absoluteStartSeconds: 5, absoluteEndSeconds: 10, shots: [{id: 'S2', startSeconds: 0, endSeconds: 5, startFrame: '첫 프레임', endFrame: '끝 프레임', camera: 'static', action: '둘 행동', dialogue: '—', sfx: 'room'}]},
    ],
  };
  value.workflow.creativeApproval = {status: 'approved', storyboardHash: 'a'.repeat(64), approvedAt: '2026-08-13T00:00:00.000Z', approvedBy: 'owner'};
  value.workflow.generationApproval = {status: 'invalidated'};
  value.workflow.releaseApproval = {status: 'invalidated'};
  value.workflow.production = {
    assets: [],
    continuityLocks: [{id: 'lock-1', sceneId: 'CUT01', status: 'draft', landmarks: [], cameraSide: 'south', axisRule: 'fixed', lightSource: 'window', shadowDirection: 'left', palette: {dominant: '#111111', secondary: '#222222', accent: '#333333'}}],
    shotSpecs: [
      {id: 'spec-1', cutId: 'CUT01', shotId: 'S1', durationSeconds: 5, characterCount: 0, format: 'single-take', activeReferences: [], continuityLockId: 'lock-1', firstFrameBlocking: [], optics: '35mm', camera: ['static'], actionBeats: [{startSeconds: 0, endSeconds: 5, action: 'act'}], physics: ['natural'], lighting: {source: 'window', direction: 'left', preserveContinuity: true}, audio: {dialogue: '—', ambience: 'room', sfx: 'cloth'}, acting: [], positiveConstraints: ['no text']},
    ],
    takes: [
      {id: 'take-a', scope: 'shot', shotSpecId: 'spec-1', structuredSpecHash: '1'.repeat(64), compiledPromptHash: '2'.repeat(64), assetBundleHash: '3'.repeat(64), continuityLockHash: '4'.repeat(64), provider: 'local', model: 'imported', outputAssetId: `ga_${'5'.repeat(32)}`, contentSha256: '6'.repeat(64), requestKey: '7'.repeat(64), qcStatus: 'legacy', takeApproval: {status: 'draft'}, verdict: 'accepted', selected: false, createdAt: '2026-08-13T00:00:00.000Z'},
      {id: 'take-b', scope: 'shot', shotSpecId: 'spec-1', structuredSpecHash: '8'.repeat(64), compiledPromptHash: '9'.repeat(64), assetBundleHash: 'a'.repeat(64), continuityLockHash: 'b'.repeat(64), provider: 'local', model: 'imported', outputAssetId: `ga_${'c'.repeat(32)}`, contentSha256: 'd'.repeat(64), requestKey: 'e'.repeat(64), qcStatus: 'legacy', takeApproval: {status: 'draft'}, verdict: 'accepted', selected: false, createdAt: '2026-08-13T00:01:00.000Z'},
    ],
  };
  value.mediaFiles = [
    {id: 'media-a', fileName: 'take-a.mp4', type: 'video', source: {kind: 'managed', assetId: `ga_${'5'.repeat(32)}`}, contentSha256: '6'.repeat(64), takeId: 'take-a', cutId: 'CUT01', shotId: 'S1', storyboardRole: 'clip', startTime: 0, endTime: 5, positionStart: 0, positionEnd: 5, includeInMerge: false, playbackSpeed: 1, volume: 100, zIndex: 1, opacity: 100},
    {id: 'media-b', fileName: 'take-b.mp4', type: 'video', source: {kind: 'managed', assetId: `ga_${'c'.repeat(32)}`}, contentSha256: 'd'.repeat(64), takeId: 'take-b', cutId: 'CUT01', shotId: 'S1', storyboardRole: 'clip', startTime: 0, endTime: 5, positionStart: 0, positionEnd: 5, includeInMerge: false, playbackSpeed: 1, volume: 100, zIndex: 1, opacity: 100},
  ];
  return value;
};

describe('P1 project production mutations', () => {
  it('attaches a managed start/end frame to the cut and invalidates creative approval', () => {
    const value = attachCutFrameAsset(project(), {cutId: 'CUT01', role: 'start', assetId: `ga_${'f'.repeat(32)}`, contentSha256: '0'.repeat(64), fileName: 'start.png'});
    expect(value.workflow.storyboard?.cuts[0]).toMatchObject({startFrameAssetId: `ga_${'f'.repeat(32)}`});
    expect(value.mediaFiles[0]).toMatchObject({cutId: 'CUT01', storyboardRole: 'start', source: {kind: 'managed'}});
    expect(value.workflow.creativeApproval.status).toBe('invalidated');
  });

  it('reorders cuts and recomputes absolute timing without changing durations', () => {
    const value = reorderStoryboardCuts(project(), ['CUT02', 'CUT01']);
    expect(value.workflow.storyboard?.cuts.map((cut) => [cut.id, cut.absoluteStartSeconds, cut.absoluteEndSeconds])).toEqual([
      ['CUT02', 0, 5], ['CUT01', 5, 10],
    ]);
  });

  it('applies a bounded Korean natural-language cut edit and invalidates approval', () => {
    const value = updateCutFromInstruction(project(), 'CUT01', '제목을 오프닝 인사로 바꾸고 행동을 카메라를 향해 천천히 돌아본다로 바꿔줘');
    expect(value.workflow.storyboard?.cuts[0].title).toBe('오프닝 인사');
    expect(value.workflow.storyboard?.cuts[0].shots[0].action).toBe('카메라를 향해 천천히 돌아본다');
    expect(value.workflow.creativeApproval.status).toBe('invalidated');
  });

  it('selects one take, places only it on the timeline, and switches versions idempotently', () => {
    let value = selectTakeForTimeline(project(), 'take-a');
    expect(value.workflow.production.takes.map((take) => [take.id, take.selected])).toEqual([['take-a', true], ['take-b', false]]);
    expect(value.mediaFiles.map((media) => [media.takeId, media.includeInMerge])).toEqual([['take-a', true], ['take-b', false]]);
    value = selectTakeForTimeline(value, 'take-b');
    expect(value.workflow.production.takes.map((take) => [take.id, take.selected])).toEqual([['take-a', false], ['take-b', true]]);
    expect(value.mediaFiles.map((media) => [media.takeId, media.includeInMerge])).toEqual([['take-a', false], ['take-b', true]]);
  });
});
