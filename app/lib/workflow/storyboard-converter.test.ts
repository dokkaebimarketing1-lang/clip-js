import {describe, expect, it} from 'vitest';
import {deriveProductionFromStoryboard} from './storyboard-converter';
import {productionManifestSchema, type ProductionManifest, type Storyboard} from './schema';

const storyboard: Storyboard = {
  version: 'v1', title: 'Derivation test', noBgm: true,
  cuts: [{
    id: 'CUT01', title: 'Opening', absoluteStartSeconds: 0, absoluteEndSeconds: 6,
    shots: [
      {id: 'S1', startSeconds: 0, endSeconds: 3, startFrame: 'museum wide', endFrame: 'door open', camera: 'wide push-in', action: 'Roco enters', dialogue: '—', sfx: 'door'},
      {id: 'S2', startSeconds: 3, endSeconds: 6, startFrame: 'altar close', endFrame: 'face reveal', camera: 'slow dolly', action: 'Roco kneels', dialogue: 'I came back.', sfx: '—'},
    ],
  }],
};

describe('storyboard to production derivation', () => {
  it('maps every shot into a schema-valid shot spec with direct fields', () => {
    const derived = deriveProductionFromStoryboard(storyboard);
    expect(productionManifestSchema.parse(derived).shotSpecs).toHaveLength(2);
    const first = derived.shotSpecs[0];
    expect(first).toMatchObject({
      cutId: 'CUT01', shotId: 'S1', durationSeconds: 3, format: 'single-take',
      camera: ['wide push-in'],
      audio: {dialogue: '—', sfx: 'door'},
      positiveConstraints: ['match approved storyboard frame: museum wide → door open'],
    });
    expect(first.actionBeats).toEqual([{startSeconds: 0, endSeconds: 3, action: 'Roco enters'}]);
    expect(first.continuityLockId).toBe('continuity-lock-CUT01');
  });

  it('creates one draft continuity lock per cut and reuses an existing lock for the scene', () => {
    const derived = deriveProductionFromStoryboard(storyboard);
    expect(derived.continuityLocks).toHaveLength(1);
    expect(derived.continuityLocks[0]).toMatchObject({id: 'continuity-lock-CUT01', sceneId: 'CUT01', status: 'draft'});
    const existing: ProductionManifest = {
      assets: [], shotSpecs: [], takes: [],
      continuityLocks: [{
        id: 'continuity-museum', sceneId: 'CUT01', status: 'locked',
        landmarks: [{id: 'altar', description: 'stone altar', frameRegion: 'right'}],
        cameraSide: 'south', axisRule: 'never cross', lightSource: 'red skylight', shadowDirection: 'left',
        palette: {dominant: '#241818', secondary: '#6f3434', accent: '#f0b45c'},
      }],
    };
    const merged = deriveProductionFromStoryboard(storyboard, existing);
    expect(merged.continuityLocks).toHaveLength(1);
    expect(merged.continuityLocks[0].id).toBe('continuity-museum');
    expect(merged.shotSpecs[0].continuityLockId).toBe('continuity-museum');
  });

  it('never duplicates or destroys existing shot specs', () => {
    const existing: ProductionManifest = {
      assets: [{
        id: 'asset-roco', tag: '@roco', type: 'character' as const, state: 'base', descriptor: 'Roco.',
        referenceUrl: 'https://cdn.example.com/roco.png', referenceHash: 'a'.repeat(64),
        editMode: 'original' as const, status: 'draft' as const, stressTests: [],
      }],
      takes: [],
      continuityLocks: [{
        id: 'continuity-lock-CUT01', sceneId: 'CUT01', status: 'draft' as const,
        landmarks: [], cameraSide: '—', axisRule: '—', lightSource: '—', shadowDirection: '—',
        palette: {dominant: '#000000', secondary: '#000000', accent: '#000000'},
      }],
      shotSpecs: [{
        id: 'refined-S1', cutId: 'CUT01', shotId: 'S1', durationSeconds: 3, characterCount: 2, format: 'hard-cuts',
        activeReferences: [{assetId: 'asset-roco', role: 'identity'}],
        continuityLockId: 'continuity-lock-CUT01',
        firstFrameBlocking: [{subject: '@roco', position: 'frame-left', action: 'stands'}],
        optics: '50mm', camera: ['custom orbit'],
        actionBeats: [{startSeconds: 0, endSeconds: 3, action: 'refined beat'}],
        physics: ['weight'], lighting: {source: 'soft top', direction: 'front', preserveContinuity: true},
        audio: {dialogue: '—', ambience: 'hall', sfx: '—'},
        acting: [{assetId: 'asset-roco', beats: ['breathe']}],
        positiveConstraints: ['one character'],
      }],
    };
    const merged = deriveProductionFromStoryboard(storyboard, existing);
    expect(merged.shotSpecs).toHaveLength(2);
    const refined = merged.shotSpecs.find((spec) => spec.cutId === 'CUT01' && spec.shotId === 'S1');
    expect(refined?.optics).toBe('50mm');
    expect(refined?.actionBeats[0].action).toBe('refined beat');
    expect(merged.shotSpecs.filter((spec) => spec.cutId === 'CUT01' && spec.shotId === 'S2')).toHaveLength(1);
    expect(productionManifestSchema.parse(merged)).toBeTruthy();
  });

  it('is deterministic and keeps unrelated production data untouched', () => {
    const existing: ProductionManifest = {
      assets: [], takes: [], continuityLocks: [],
      shotSpecs: [{id: 'shot-spec-1', cutId: 'CUT01', shotId: 'S1', durationSeconds: 3, characterCount: 1, format: 'single-take', activeReferences: [], continuityLockId: 'continuity-lock-CUT01', firstFrameBlocking: [], optics: '35mm', camera: ['wide push-in'], actionBeats: [{startSeconds: 0, endSeconds: 3, action: 'Roco enters'}], physics: [], lighting: {source: '—', direction: '—', preserveContinuity: false}, audio: {dialogue: '—', ambience: '—', sfx: 'door'}, acting: [], positiveConstraints: []}],
    };
    const first = deriveProductionFromStoryboard(storyboard, existing);
    const second = deriveProductionFromStoryboard(storyboard, existing);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.shotSpecs).toHaveLength(2);
    expect(first.takes).toEqual([]);
  });
});
