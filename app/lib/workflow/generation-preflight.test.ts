import {describe, expect, it} from 'vitest';
import {initialState} from '@/app/store/slices/projectSlice';
import {deriveGenerationPreflight} from './generation-preflight';

const readyProject = () => {
  const project = structuredClone(initialState);
  project.id = 'preflight-project';
  project.workflow.storyboard = {
    version: 'v1', title: '20초 카나리', noBgm: true,
    cuts: [{id: 'CUT01', title: '오프닝', absoluteStartSeconds: 0, absoluteEndSeconds: 20, startFrameAssetId: `ga_${'1'.repeat(32)}`, endFrameAssetId: `ga_${'2'.repeat(32)}`, shots: [{id: 'S1', startSeconds: 0, endSeconds: 20, startFrame: '시작', endFrame: '끝', camera: 'static', action: '행동', dialogue: '—', sfx: 'room'}]}],
  };
  project.workflow.production = {
    assets: [],
    continuityLocks: [{id: 'lock-1', sceneId: 'CUT01', status: 'draft', landmarks: [], cameraSide: 'south', axisRule: 'fixed', lightSource: 'window', shadowDirection: 'left', palette: {dominant: '#111111', secondary: '#222222', accent: '#333333'}}],
    shotSpecs: [{id: 'spec-1', cutId: 'CUT01', shotId: 'S1', durationSeconds: 20, characterCount: 0, format: 'single-take', activeReferences: [], continuityLockId: 'lock-1', firstFrameBlocking: [], optics: '35mm', camera: ['static'], actionBeats: [{startSeconds: 0, endSeconds: 20, action: 'act'}], physics: ['natural'], lighting: {source: 'window', direction: 'left', preserveContinuity: true}, audio: {dialogue: '—', ambience: 'room', sfx: 'room'}, acting: [], positiveConstraints: ['no text']}],
    takes: [],
  };
  project.aspectRatio = '16:9';
  project.workflow.seedanceMaster = {...project.workflow.seedanceMaster, duration: 20, resolution: '480p', axes: {...project.workflow.seedanceMaster.axes, task: 't2v', durationStructure: '20s-4stage'}};
  project.workflow.creativeApproval = {status: 'approved', storyboardHash: 'a'.repeat(64), approvedAt: '2026-08-13T00:00:00.000Z', approvedBy: 'owner'};
  return project;
};

describe('generation preflight', () => {
  it('reports a complete generation-ready package without authorizing paid submission', () => {
    const result = deriveGenerationPreflight(readyProject(), false);
    expect(result.readyForAuthorization).toBe(true);
    expect(result.providerSubmitEnabled).toBe(false);
    expect(result.checks.map((check) => [check.id, check.passed])).toEqual([
      ['storyboard', true], ['frames', true], ['production', true], ['creative-approval', true], ['canary-shape', true],
    ]);
  });

  it('identifies every missing cut frame before generation', () => {
    const project = readyProject();
    delete project.workflow.storyboard!.cuts[0].endFrameAssetId;
    const result = deriveGenerationPreflight(project, false);
    expect(result.readyForAuthorization).toBe(false);
    expect(result.missingFrameCutIds).toEqual(['CUT01']);
  });
});
