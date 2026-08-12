import {describe, expect, it} from 'vitest';
import {buildDefaultSeedanceMasterSettings} from '@/app/lib/workflow/seedance-master';
import type {ProductionManifest} from '@/app/lib/workflow/production-schema';
import type {Storyboard} from '@/app/lib/workflow/schema';
import {
  BYTEPLUS_CREATE_TASK_URL,
  BYTEPLUS_SEEDANCE_25_MODEL,
  bytePlusCreateTaskResponseSchema,
  bytePlusRetrieveTaskResponseSchema,
  compileBytePlusCanonicalRequest,
  computeBytePlusRequestHash,
  materializeBytePlusCreateTaskRequest,
  type BytePlusReferenceIdentity,
} from './byteplus-adapter';

const storyboard: Storyboard = {
  version: 'v1', title: 'Official BytePlus fixture', noBgm: true,
  cuts: [{id: 'CUT01', title: 'Opening', absoluteStartSeconds: 0, absoluteEndSeconds: 30, shots: [{id: 'S1', startSeconds: 0, endSeconds: 30, startFrame: 'consultation room wide', endFrame: 'counselor reassures', camera: 'slow push-in', action: 'counselor listens and reassures', dialogue: '—', sfx: 'quiet room tone'}]}],
};
const stressTests = Array.from({length: 10}, (_, index) => ({
  id: `stress-${index + 1}`, pose: `pose-${index + 1}`, lighting: index % 2 ? 'night' : 'day', coAssetIds: [], resultAssetId: `result-${index + 1}`, verdict: 'pass' as const,
}));
const production: ProductionManifest = {
  assets: [{id: 'asset-1', tag: '@counselor', type: 'character', state: 'base', descriptor: 'A fictional counselor in a text-free room.', referenceUrl: 'https://assets.example.test/counselor.png', referenceHash: 'a'.repeat(64), editMode: 'original', status: 'locked', stressTests}],
  continuityLocks: [{id: 'lock-1', sceneId: 'CUT01', status: 'locked', landmarks: [{id: 'desk', description: 'plain wooden desk', frameRegion: 'center'}], cameraSide: 'south side', axisRule: 'do not cross desk axis', lightSource: 'soft window light', shadowDirection: 'frame-left', palette: {dominant: '#241818', secondary: '#6f3434', accent: '#f0b45c'}}],
  shotSpecs: [{id: 'spec-1', cutId: 'CUT01', shotId: 'S1', durationSeconds: 30, characterCount: 1, format: 'single-take', activeReferences: [{assetId: 'asset-1', role: 'identity'}], continuityLockId: 'lock-1', firstFrameBlocking: [{subject: '@counselor', position: 'center', action: 'waits calmly'}], optics: '35mm', camera: ['slow push-in'], actionBeats: [{startSeconds: 0, endSeconds: 30, action: 'listen and reassure'}], physics: ['natural body inertia'], lighting: {source: 'window', direction: 'back-right', preserveContinuity: true}, audio: {dialogue: '—', ambience: 'quiet room', sfx: 'soft cloth'}, acting: [{assetId: 'asset-1', beats: ['eyes move before head']}], positiveConstraints: ['exactly one character', 'no readable text']}],
  takes: [],
};
const reference = (overrides: Partial<BytePlusReferenceIdentity> = {}): BytePlusReferenceIdentity => ({
  assetId: 'ga_1234567890abcdef1234567890abcdef', contentSha256: 'b'.repeat(64), mediaType: 'image', role: 'reference_image', portraitHandling: 'no-real-human-face', ...overrides,
});

describe('BytePlus Seedance 2.5 compile-only adapter', () => {
  it('compiles exact official t2v fields and never emits unsupported legacy flags', async () => {
    const settings = buildDefaultSeedanceMasterSettings();
    const canonical = compileBytePlusCanonicalRequest({storyboard, production, settings, references: []});
    expect(BYTEPLUS_CREATE_TASK_URL).toBe('https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks');
    expect(canonical.model).toBe(BYTEPLUS_SEEDANCE_25_MODEL);
    const payload = await materializeBytePlusCreateTaskRequest(canonical, async () => { throw new Error('resolver must not run for t2v'); });
    expect(payload).toMatchObject({model: 'dreamina-seedance-2-5-260628', duration: 30, ratio: '16:9', resolution: '720p', generate_audio: false, watermark: false, return_last_frame: false});
    expect(payload.content).toHaveLength(1);
    expect(payload.content[0]).toMatchObject({type: 'text'});
    expect(payload).not.toHaveProperty('omni_reference_task_type');
    expect(Object.keys(payload)).not.toEqual(expect.arrayContaining(['seed', 'camera_fixed', 'image_references', 'extension_mode']));
    expect(payload.model).not.toContain('doubao');
  });

  it('binds authorization identity to asset hashes rather than expiring transport URLs', async () => {
    const settings = buildDefaultSeedanceMasterSettings();
    settings.axes.task = 'r2v';
    const canonical = compileBytePlusCanonicalRequest({storyboard, production, settings, references: [reference()]});
    const hashBefore = await computeBytePlusRequestHash(canonical);
    const first = await materializeBytePlusCreateTaskRequest(canonical, async () => 'https://signed-a.example.test/ref?expires=1');
    const second = await materializeBytePlusCreateTaskRequest(canonical, async () => 'https://signed-b.example.test/ref?expires=2');
    expect(await computeBytePlusRequestHash(canonical)).toBe(hashBefore);
    expect(first).not.toEqual(second);
    expect(first.omni_reference_task_type).toBe('reference');
    expect(first.content[1]).toMatchObject({type: 'image_url', role: 'reference_image'});
  });

  it('maps edit and extend tasks to the official omni reference task types', async () => {
    const video = reference({mediaType: 'video', role: 'reference_video'});

    const editSettings = buildDefaultSeedanceMasterSettings();
    editSettings.axes.task = 'edit';
    const editCanonical = compileBytePlusCanonicalRequest({storyboard, production, settings: editSettings, references: [video]});
    const editPayload = await materializeBytePlusCreateTaskRequest(editCanonical, async () => 'https://signed.example.test/source.mp4');
    expect(editPayload.omni_reference_task_type).toBe('edit');

    const extendSettings = buildDefaultSeedanceMasterSettings();
    extendSettings.axes.task = 'ext';
    const extendCanonical = compileBytePlusCanonicalRequest({storyboard, production, settings: extendSettings, references: [video]});
    const extendPayload = await materializeBytePlusCreateTaskRequest(extendCanonical, async () => 'https://signed.example.test/source.mp4');
    expect(extendPayload.omni_reference_task_type).toBe('extend');
  });

  it('supports pure-audio R2V and enforces the 2.5 30/10/10 media caps', () => {
    const settings = buildDefaultSeedanceMasterSettings();
    settings.axes.task = 'r2v';
    const audio = reference({assetId: 'ga_abcdefabcdefabcdefabcdefabcdefab', mediaType: 'audio', role: 'reference_audio'});
    expect(() => compileBytePlusCanonicalRequest({storyboard, production, settings, references: [audio]})).not.toThrow();
    const refs = [
      ...Array.from({length: 31}, (_, index) => reference({assetId: `image-${index}`})),
    ];
    expect(() => compileBytePlusCanonicalRequest({storyboard, production, settings, references: refs})).toThrow(/30 image/i);
  });

  it('rejects direct real-person references and enforces first/last and edit task combinations', () => {
    const settings = buildDefaultSeedanceMasterSettings();
    settings.axes.task = 'r2v';
    expect(() => compileBytePlusCanonicalRequest({storyboard, production, settings, references: [reference({portraitHandling: 'direct-real-human-face'})]})).toThrow(/portrait/i);

    settings.axes.task = 'fl';
    expect(() => compileBytePlusCanonicalRequest({storyboard, production, settings, references: [reference({role: 'last_frame'})]})).toThrow(/first_frame/i);
    expect(() => compileBytePlusCanonicalRequest({storyboard, production, settings, references: [reference({role: 'first_frame'}), reference({assetId: 'ga_abcdefabcdefabcdefabcdefabcdefab', role: 'last_frame'})]})).not.toThrow();

    settings.axes.task = 'edit';
    expect(() => compileBytePlusCanonicalRequest({storyboard, production, settings, references: [reference()]})).toThrow(/reference_video/i);
  });

  it('strictly parses documented create/retrieve response states and URLs', () => {
    expect(bytePlusCreateTaskResponseSchema.parse({id: 'task-1'}).id).toBe('task-1');
    const succeeded = bytePlusRetrieveTaskResponseSchema.parse({
      id: 'task-1', model: BYTEPLUS_SEEDANCE_25_MODEL, status: 'succeeded', created_at: 1, updated_at: 2,
      content: {video_url: 'https://results.example.test/video.mp4'}, duration: 30, framespersecond: 24, generate_audio: false, output_format: 'mp4', ratio: '16:9', resolution: '720p', error: null,
      usage: {completion_tokens: 195, total_tokens: 195},
    });
    expect(succeeded.content?.video_url).toContain('https://');
    expect(() => bytePlusRetrieveTaskResponseSchema.parse({id: 'task-1', status: 'complete'})).toThrow();
    expect(() => bytePlusCreateTaskResponseSchema.parse({id: 'task-1', unexpected: true})).toThrow();
  });
});
