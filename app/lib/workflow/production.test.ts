import {describe, expect, it} from 'vitest';
import {initialState} from '@/app/store/slices/projectSlice';
import {approveStoryboard, assertVideoGenerationAllowed} from './approval';
import {
  createDefaultWorkflow,
  productionManifestSchema,
  type ProductionManifest,
  type Storyboard,
} from './schema';
import {compileShotPrompt, createGenerationTake} from './production';
import {previewAgentCommand} from '../agent/commands';

const storyboard: Storyboard = {
  version: 'v1', title: 'Production manifest', noBgm: true,
  cuts: [{id: 'CUT01', title: 'Opening', absoluteStartSeconds: 0, absoluteEndSeconds: 4, shots: [{id: 'S1', startSeconds: 0, endSeconds: 4, startFrame: 'museum wide', endFrame: 'door open', camera: 'wide push', action: 'enter', dialogue: '—', sfx: 'door'}]}],
};

const stressTests = Array.from({length: 10}, (_, index) => ({
  id: `stress-${index + 1}`,
  pose: `pose-${index + 1}`,
  lighting: index % 2 ? 'night' : 'day',
  coAssetIds: [],
  resultAssetId: `result-${index + 1}`,
  verdict: 'pass' as const,
}));

const production: ProductionManifest = {
  assets: [{
    id: 'asset-roco', tag: '@roco', type: 'character', state: 'base',
    descriptor: 'Roco, lean street leader, weathered red jacket.',
    referenceUrl: 'https://cdn.example.com/roco.png',
    referenceHash: 'a'.repeat(64), editMode: 'original', status: 'locked', stressTests,
  }],
  continuityLocks: [{
    id: 'continuity-museum', sceneId: 'CUT01', status: 'locked',
    landmarks: [{id: 'altar', description: 'stone altar', frameRegion: 'right'}],
    cameraSide: 'south side of the hall', axisRule: 'never cross the altar-door axis',
    lightSource: 'single red skylight', shadowDirection: 'toward frame-left',
    palette: {dominant: '#241818', secondary: '#6f3434', accent: '#f0b45c'},
  }],
  shotSpecs: [{
    id: 'shot-spec-1', cutId: 'CUT01', shotId: 'S1', durationSeconds: 4,
    characterCount: 1, format: 'single-take',
    activeReferences: [{assetId: 'asset-roco', role: 'identity'}],
    continuityLockId: 'continuity-museum',
    firstFrameBlocking: [{subject: '@roco', position: 'frame-left', action: 'stands still'}],
    optics: '35mm', camera: ['slow push-in'],
    actionBeats: [{startSeconds: 0, endSeconds: 1, action: 'hold calibration wide'}, {startSeconds: 1, endSeconds: 4, action: 'Roco enters'}],
    physics: ['natural body inertia'],
    lighting: {source: 'red skylight', direction: 'back-right', preserveContinuity: true},
    audio: {dialogue: '—', ambience: 'museum room tone', sfx: 'door hinge'},
    acting: [{assetId: 'asset-roco', beats: ['eyes move before head', 'jaw tightens once']}],
    positiveConstraints: ['exactly one character', 'no duplicates'],
  }],
  takes: [],
};

describe('Hell Grind production manifest', () => {
  it('fails closed when a locked asset lacks ten passing stress tests', () => {
    const invalid = structuredClone(production);
    invalid.assets[0].stressTests.pop();
    expect(() => productionManifestSchema.parse(invalid)).toThrow(/ten passing stress tests/i);
  });

  it('compiles a deterministic role-tagged prompt from locked production data', async () => {
    const first = await compileShotPrompt(production, 'shot-spec-1');
    const second = await compileShotPrompt(structuredClone(production), 'shot-spec-1');
    expect(first).toBe(second);
    expect(first).toContain('EXACT 1 CHARACTER');
    expect(first).toContain('@roco — identity reference');
    expect(first).toContain('GEO SPATIAL LAYOUT');
    expect(first).toContain('0.000–1.000s: hold calibration wide');
    expect(first).toContain('grounded action fantasy');
    expect(first).toContain('stable anatomy');
  });

  it('makes production changes stale against the exact storyboard approval', async () => {
    const workflow = {...createDefaultWorkflow(), storyboard, production};
    workflow.approval = await approveStoryboard(storyboard, 'owner', new Date('2026-01-01T00:00:00Z'), production);
    await expect(assertVideoGenerationAllowed(workflow)).resolves.toBeUndefined();
    const changed = structuredClone(workflow);
    changed.production.shotSpecs[0].camera = ['handheld orbit'];
    await expect(assertVideoGenerationAllowed(changed)).rejects.toThrow(/production manifest changed/i);
  });

  it('records a take through Agent Preview with immutable provenance hashes', async () => {
    const project = structuredClone(initialState);
    project.id = 'production-project';
    project.workflow = {...createDefaultWorkflow(), storyboard, production};
    const change = await previewAgentCommand(project, {
      type: 'record_generation_take', shotSpecId: 'shot-spec-1',
      provider: 'higgsfield', model: 'seedance_2_0', verdict: 'accepted',
      outputAssetId: 'generated-clip-1',
    });
    const take = change.proposedProject.workflow.production.takes[0];
    expect(take).toMatchObject({shotSpecId: 'shot-spec-1', provider: 'higgsfield', model: 'seedance_2_0', verdict: 'accepted'});
    expect(take.structuredSpecHash).toMatch(/^[a-f0-9]{64}$/);
    expect(take.compiledPromptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(take.assetBundleHash).toMatch(/^[a-f0-9]{64}$/);
    expect(take.continuityLockHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('escalates the fifteenth consecutive failed take to simplify-shot', async () => {
    const failed = structuredClone(production);
    failed.takes = Array.from({length: 14}, (_, index) => ({
      id: `failed-${index}`,
      shotSpecId: 'shot-spec-1',
      structuredSpecHash: 'a'.repeat(64),
      compiledPromptHash: 'b'.repeat(64),
      assetBundleHash: 'c'.repeat(64),
      continuityLockHash: 'd'.repeat(64),
      provider: 'higgsfield',
      model: 'seedance_2_0',
      verdict: 'bad-roll' as const,
      selected: false,
      createdAt: new Date(index * 1000).toISOString(),
    }));
    const take = await createGenerationTake(failed, {
      shotSpecId: 'shot-spec-1', provider: 'higgsfield', model: 'seedance_2_0', verdict: 'bad-roll',
    });
    expect(take.verdict).toBe('simplify-shot');
  });

  it('fails closed when two takes for the same shot are selected', async () => {
    const first = await createGenerationTake(production, {
      shotSpecId: 'shot-spec-1', provider: 'higgsfield', model: 'seedance_2_0', verdict: 'accepted',
    });
    const second = await createGenerationTake(production, {
      shotSpecId: 'shot-spec-1', provider: 'higgsfield', model: 'seedance_2_0', verdict: 'accepted',
    });
    expect(() => productionManifestSchema.parse({...production, takes: [{...first, selected: true}, {...second, selected: true}]}))
      .toThrow(/more than one selected take/i);
  });

  it('promotes only accepted takes and keeps one selection per shot spec', async () => {
    const project = structuredClone(initialState);
    project.workflow = {...createDefaultWorkflow(), storyboard, production};
    project.workflow.approval = await approveStoryboard(storyboard, 'owner', new Date('2026-01-01T00:00:00Z'), production);
    const first = await previewAgentCommand(project, {
      type: 'record_generation_take', shotSpecId: 'shot-spec-1',
      provider: 'higgsfield', model: 'seedance_2_0', verdict: 'accepted', outputAssetId: 'clip-1',
    });
    const second = await previewAgentCommand(first.proposedProject, {
      type: 'record_generation_take', shotSpecId: 'shot-spec-1',
      provider: 'higgsfield', model: 'seedance_2_0', verdict: 'accepted', outputAssetId: 'clip-2',
    });
    const firstTakeId = first.proposedProject.workflow.production.takes[0].id;
    const promoted = await previewAgentCommand(second.proposedProject, {type: 'select_generation_take', takeId: firstTakeId});
    let takes = promoted.proposedProject.workflow.production.takes;
    expect(takes.filter((take) => take.selected)).toHaveLength(1);
    expect(takes.find((take) => take.id === firstTakeId)?.selected).toBe(true);
    expect(promoted.proposedProject.workflow.approval.status).toBe('invalidated');
    const switched = await previewAgentCommand(promoted.proposedProject, {
      type: 'select_generation_take', takeId: second.proposedProject.workflow.production.takes[1].id,
    });
    takes = switched.proposedProject.workflow.production.takes;
    expect(takes.filter((take) => take.selected)).toHaveLength(1);
    expect(takes.find((take) => take.id === firstTakeId)?.selected).toBe(false);
    expect(takes.find((take) => take.id === second.proposedProject.workflow.production.takes[1].id)?.selected).toBe(true);
  });

  it('rejects promotion of a non-accepted take', async () => {
    const project = structuredClone(initialState);
    project.workflow = {...createDefaultWorkflow(), storyboard, production};
    const recorded = await previewAgentCommand(project, {
      type: 'record_generation_take', shotSpecId: 'shot-spec-1',
      provider: 'higgsfield', model: 'seedance_2_0', verdict: 'bad-roll',
    });
    const takeId = recorded.proposedProject.workflow.production.takes[0].id;
    await expect(previewAgentCommand(recorded.proposedProject, {type: 'select_generation_take', takeId}))
      .rejects.toThrow(/accepted/i);
  });
});
