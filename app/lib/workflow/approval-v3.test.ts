import {describe, expect, it} from 'vitest';
import {createDefaultWorkflow, workflowStateSchema} from './schema';
import {buildDefaultSeedanceMasterSettings} from './seedance-master';
import {computeGenerationBlueprintHash, computeRenderInputHash} from './approval-v3';
import {productionManifestSchema, type ProductionManifest} from './production-schema';
import type {ProjectState} from '@/app/types';

const storyboard = {
  version: '2', title: 'Approval split', noBgm: true as const,
  cuts: [{
    id: 'CUT01', title: 'cut', absoluteStartSeconds: 0, absoluteEndSeconds: 20,
    shots: [{id: 'S1', startSeconds: 0, endSeconds: 20, startFrame: 'start', endFrame: 'end', camera: 'locked', action: 'move', dialogue: '—', sfx: '—'}],
  }],
};

const production = (): ProductionManifest => productionManifestSchema.parse({
  assets: [],
  continuityLocks: [{
    id: 'lock-1', sceneId: 'scene-1', status: 'locked', landmarks: [], cameraSide: 'left', axisRule: 'keep',
    lightSource: 'window', shadowDirection: 'right', palette: {dominant: '#111111', secondary: '#222222', accent: '#333333'},
  }],
  shotSpecs: [{
    id: 'shot-1', cutId: 'CUT01', shotId: 'S1', durationSeconds: 20, characterCount: 0, format: 'single-take',
    activeReferences: [], continuityLockId: 'lock-1', firstFrameBlocking: [], optics: '35mm', camera: ['locked'],
    actionBeats: [{startSeconds: 0, endSeconds: 20, action: 'move'}], physics: [],
    lighting: {source: 'window', direction: 'right', preserveContinuity: true},
    audio: {dialogue: '', ambience: '', sfx: ''}, acting: [], positiveConstraints: ['no text'],
  }],
  takes: [],
});

const projectFixture = (manifest: ProductionManifest): ProjectState => ({
  projectSchemaVersion: 3,
  revision: 0,
  id: 'project-1', projectName: 'Project', createdAt: '2026-01-01T00:00:00.000Z', lastModified: '2026-01-01T00:00:00.000Z',
  mediaFiles: [], textElements: [], shapes: [], currentTime: 0, isPlaying: false, isMuted: false, duration: 20, zoomLevel: 1,
  timelineZoom: 100, enableMarkerTracking: true, activeSection: 'workflow', activeElement: null, activeElementIndex: 0,
  resolution: {width: 1920, height: 1080}, fps: 30, aspectRatio: '16:9', history: [], future: [],
  exportSettings: {resolution: '1080p', quality: 'high', speed: 'fastest', fps: 30, format: 'mp4', includeSubtitles: true},
  workflow: {...createDefaultWorkflow(), storyboard, production: manifest},
});

describe('approval v3 boundaries', () => {
  it('creates separate draft approval states and strips the legacy single approval', () => {
    const defaults = createDefaultWorkflow();
    expect(defaults.creativeApproval.status).toBe('draft');
    expect(defaults.generationApproval.status).toBe('draft');
    expect(defaults.releaseApproval.status).toBe('draft');
    expect('approval' in defaults).toBe(false);

    const migrated = workflowStateSchema.parse({...defaults, creativeApproval: undefined, generationApproval: undefined, releaseApproval: undefined, approval: {status: 'approved', storyboardHash: 'a'.repeat(64)}});
    expect(migrated.creativeApproval.status).toBe('invalidated');
    expect(migrated.generationApproval.status).toBe('invalidated');
    expect(migrated.releaseApproval.status).toBe('invalidated');
    expect('approval' in migrated).toBe(false);
  });

  it('keeps the generation blueprint hash stable when mutable takes are added', async () => {
    const manifest = production();
    const settings = buildDefaultSeedanceMasterSettings();
    const before = await computeGenerationBlueprintHash(storyboard, manifest, settings);
    const withTake = productionManifestSchema.parse({
      ...manifest,
      takes: [{
        id: 'take-1', shotSpecId: 'shot-1', structuredSpecHash: 'a'.repeat(64), compiledPromptHash: 'b'.repeat(64),
        assetBundleHash: 'c'.repeat(64), continuityLockHash: 'd'.repeat(64), provider: 'fake', model: 'fake-model',
        verdict: 'accepted', selected: true, createdAt: '2026-01-01T00:00:00.000Z',
      }],
    });
    const after = await computeGenerationBlueprintHash(storyboard, withTake, settings);
    expect(after).toBe(before);

    const changed = productionManifestSchema.parse({...manifest, shotSpecs: [{...manifest.shotSpecs[0], optics: '50mm'}]});
    await expect(computeGenerationBlueprintHash(storyboard, changed, settings)).resolves.not.toBe(before);
  });

  it('binds release approval to render semantics but ignores runtime-only playback state', async () => {
    const base = projectFixture(production());
    const hash = await computeRenderInputHash(base);
    await expect(computeRenderInputHash({...base, currentTime: 10, isPlaying: true, history: [base]})).resolves.toBe(hash);
    await expect(computeRenderInputHash({...base, workflow: {...base.workflow, captions: [{
      id: 'caption-1', text: '정확한 자막', startSeconds: 0, endSeconds: 2, kind: 'dialogue', preset: 'dialogue-clean',
      position: 'bottom', intensity: 0.5, accentColor: '#ffd43b', fontFamily: 'Noto Sans KR Variable', wordTimings: [], emphasis: [], safeArea: true,
    }]}})).resolves.not.toBe(hash);
    await expect(computeRenderInputHash({...base, shapes: [{
      id: 'shape-1', type: 'rect', positionStart: 0, positionEnd: 2, x: 0, y: 0,
      width: 100, height: 100, color: '#ffffff', opacity: 100, zIndex: 1,
    }]})).resolves.not.toBe(hash);
  });
});
