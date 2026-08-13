import {describe, expect, it} from 'vitest';
import {initialState} from '@/app/store/slices/projectSlice';
import {generationRecordSchema} from '@/app/lib/generation/generation-schema';
import {prepareApprovedTakeImport, upsertQcPendingTake} from './generated-take';

const project = () => {
  const value = structuredClone(initialState);
  value.id = 'project-1';
  value.projectName = 'Take import';
  value.workflow.storyboard = {
    version: 'v1', title: 'Take import', noBgm: true,
    cuts: [{id: 'CUT01', title: 'Opening', absoluteStartSeconds: 0, absoluteEndSeconds: 30, shots: [{id: 'S1', startSeconds: 0, endSeconds: 30, startFrame: 'start', endFrame: 'end', camera: 'static', action: 'act', dialogue: '—', sfx: 'room'}]}],
  };
  value.workflow.production = {
    assets: [],
    continuityLocks: [{id: 'lock-1', sceneId: 'CUT01', status: 'locked', landmarks: [], cameraSide: 'south', axisRule: 'fixed', lightSource: 'window', shadowDirection: 'left', palette: {dominant: '#111111', secondary: '#222222', accent: '#333333'}}],
    shotSpecs: [{id: 'spec-1', cutId: 'CUT01', shotId: 'S1', durationSeconds: 30, characterCount: 0, format: 'single-take', activeReferences: [], continuityLockId: 'lock-1', firstFrameBlocking: [], optics: '35mm', camera: ['static'], actionBeats: [{startSeconds: 0, endSeconds: 30, action: 'act'}], physics: ['natural'], lighting: {source: 'window', direction: 'left', preserveContinuity: true}, audio: {dialogue: '—', ambience: 'room', sfx: 'cloth'}, acting: [], positiveConstraints: ['no readable text']}],
    takes: [],
  };
  value.workflow.generationApproval = {
    status: 'approved', authorizationVersion: 1, projectId: value.id,
    generationBlueprintHash: 'a'.repeat(64), storyboardHash: 'b'.repeat(64), productionInputHash: 'c'.repeat(64), seedanceMasterHash: 'd'.repeat(64),
    attemptId: 'attempt-1', provider: 'byteplus', model: 'dreamina-seedance-2-5-260628', providerApiVersion: 'v3', compilerVersion: 'compiler-v1', policyVersion: 'policy-v1', requestHash: 'e'.repeat(64),
    approvedAt: '2026-08-11T00:00:00.000Z', approvedBy: 'owner', signature: 'f'.repeat(64),
  };
  return value;
};

const record = generationRecordSchema.parse({
  version: 1, revision: 5, requestKey: '1'.repeat(64),
  claim: {version: 1, status: 'submitted', projectId: 'project-1', attemptId: 'attempt-1', requestKey: '1'.repeat(64), requestHash: 'e'.repeat(64), providerJobId: 'provider-1', createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:01:00.000Z'},
  job: {version: 1, status: 'ready', projectId: 'project-1', attemptId: 'attempt-1', requestKey: '1'.repeat(64), requestHash: 'e'.repeat(64), provider: 'byteplus', model: 'dreamina-seedance-2-5-260628', authorizedDuration: 30, actualDurationSeconds: 29.5, authorizedResolution: '720p', takeScope: 'shot', targetShotSpecId: 'spec-1', authorizationRef: 'f'.repeat(64), providerJobId: 'provider-1', assetId: `ga_${'2'.repeat(32)}`, contentSha256: '3'.repeat(64), takeId: `take_${'4'.repeat(32)}`, qcStatus: 'qc_pending', createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:01:00.000Z'},
});

describe('generated Take recovery and durable import preparation', () => {
  it('upserts a qc_pending Take without placing media, then imports an approved Take once', () => {
    let value = project();
    for (let index = 0; index < 10; index += 1) value = upsertQcPendingTake(value, record);
    expect(value.workflow.production.takes).toHaveLength(1);
    expect(value.mediaFiles).toHaveLength(0);
    const take = value.workflow.production.takes[0];
    const approval = {
      status: 'approved' as const, takeId: take.id, assetId: take.outputAssetId!, contentSha256: take.contentSha256!,
      approvedAt: '2026-08-11T00:02:00.000Z', approvedBy: 'owner', signature: '5'.repeat(64),
    };
    for (let index = 0; index < 10; index += 1) value = prepareApprovedTakeImport(value, take.id, approval, record.job.status === 'ready' ? record.job.actualDurationSeconds : 0);
    expect(value.mediaFiles).toHaveLength(1);
    expect(value.mediaFiles[0]).toMatchObject({generatedAssetId: record.job.status === 'ready' ? record.job.assetId : '', takeId: take.id, cutId: 'CUT01', shotId: 'S1', source: {kind: 'generated'}});
    expect(value.workflow.storyboard?.cuts[0].generatedTakeIds).toContain(take.id);
    expect(value.mediaFiles[0].positionEnd).toBe(29.5);
    expect(value.workflow.production.takes[0]).toMatchObject({qcStatus: 'approved', selected: true, verdict: 'accepted'});
  });

  it('rejects a ready record from a different authorization lineage', () => {
    const stale = structuredClone(record);
    stale.claim.attemptId = 'old-attempt';
    stale.job.attemptId = 'old-attempt';
    expect(() => upsertQcPendingTake(project(), stale)).toThrow(/authorization lineage/i);
  });

  it('rejects an approval bound to another binary', () => {
    const value = upsertQcPendingTake(project(), record);
    const take = value.workflow.production.takes[0];
    expect(() => prepareApprovedTakeImport(value, take.id, {status: 'approved', takeId: take.id, assetId: take.outputAssetId!, contentSha256: '9'.repeat(64), approvedAt: '2026-08-11T00:02:00.000Z', approvedBy: 'owner', signature: '5'.repeat(64)}, 30)).toThrow(/does not match/i);
  });
});
