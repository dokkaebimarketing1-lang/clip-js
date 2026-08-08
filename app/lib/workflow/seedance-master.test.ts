import {describe, expect, it} from 'vitest';
import type {ProductionManifest} from './production-schema';
import type {Storyboard} from './schema';
import {
  buildDefaultSeedanceMasterSettings,
  buildHiggsfieldCliArgs,
  compileHiggsfieldSeedanceRequest,
  higgsfieldSeedanceRequestSchema,
  seedanceMasterSettingsSchema,
} from './seedance-master';

const storyboard: Storyboard = {
  version: 'v2',
  title: '사주천궁 30초 광고',
  noBgm: true,
  cuts: [{
    id: 'CUT01', title: '접수', absoluteStartSeconds: 0, absoluteEndSeconds: 30,
    shots: [{
      id: 'S1', startSeconds: 0, endSeconds: 30,
      startFrame: '사주카페 전경', endFrame: '접수원이 카메라를 본다',
      camera: '느린 돌리 인', action: '남자가 호랑이를 업고 들어온다',
      dialogue: '접수원: 지금 바로 상담 가능해요.', sfx: '문이 열리는 소리',
    }],
  }],
};

const production: ProductionManifest = {
  assets: [],
  continuityLocks: [{
    id: 'lock-1', sceneId: 'CUT01', status: 'locked',
    landmarks: [{id: 'counter', description: '나무 접수대', frameRegion: 'right'}],
    cameraSide: '접수대 정면', axisRule: '접수대 축을 넘지 않는다',
    lightSource: '천장 카페 조명', shadowDirection: '화면 왼쪽',
    palette: {dominant: '#5b4636', secondary: '#c8ad88', accent: '#b2202a'},
  }],
  shotSpecs: [{
    id: 'spec-1', cutId: 'CUT01', shotId: 'S1', durationSeconds: 30,
    characterCount: 2, format: 'single-take', activeReferences: [], continuityLockId: 'lock-1',
    firstFrameBlocking: [{subject: '남자', position: '화면 왼쪽', action: '호랑이를 업고 서 있다'}],
    optics: '35mm', camera: ['느린 돌리 인'],
    actionBeats: [{startSeconds: 0, endSeconds: 30, action: '남자가 들어오고 접수원이 안내한다'}],
    physics: ['호랑이 몸의 무게가 남자의 걸음에 자연스럽게 반영된다'],
    lighting: {source: '천장 카페 조명', direction: '위쪽', preserveContinuity: true},
    audio: {dialogue: '접수원: 지금 바로 상담 가능해요.', ambience: '조용한 카페', sfx: '문이 열리는 소리'},
    acting: [], positiveConstraints: ['실사 한국 광고'],
    style: ['포토리얼리즘', '데드팬 코미디'], quality: '안정적인 얼굴과 자연스러운 움직임',
    endState: '접수원이 카메라를 바라보며 장면이 끝난다',
  }],
  takes: [],
};

describe('Seedance master → Higgsfield compiler', () => {
  it('keeps the learned 28-axis settings internally', () => {
    const settings = buildDefaultSeedanceMasterSettings();
    expect(Object.keys(settings.axes)).toHaveLength(28);
    expect(settings.axes.task).toBe('t2v');
  });

  it('flattens all direction into one complete prompt without builder placeholders', () => {
    const request = compileHiggsfieldSeedanceRequest({storyboard, production, settings: buildDefaultSeedanceMasterSettings()});
    expect(request.prompt).toContain('【任务类型】文生视频');
    expect(request.prompt).toContain('0.000–30.000秒');
    expect(request.prompt).toContain('{접수원: 지금 바로 상담 가능해요.}');
    expect(request.prompt).toContain('END STATE');
    expect(request.prompt).toContain('电影感运镜');
    expect(request.prompt).toContain('对话{}');
    expect(request.prompt).not.toContain('calm-formal');
    expect(request.prompt).not.toContain('<주체>');
    expect(request.prompt).not.toContain('<주요 동작>');
    expect(request.prompt).not.toContain('═══ 生成参数');
  });

  it('emits only fields accepted by the current Higgsfield Seedance 2.5 schema', () => {
    const request = compileHiggsfieldSeedanceRequest({storyboard, production, settings: buildDefaultSeedanceMasterSettings()});
    expect(Object.keys(request).sort()).toEqual([
      'aspect_ratio', 'duration', 'generate_audio', 'mode', 'prompt', 'resolution',
    ]);
    expect(request).not.toHaveProperty('model');
    expect(request).not.toHaveProperty('ratio');
    expect(request).not.toHaveProperty('output_format');
    expect(request).not.toHaveProperty('watermark');
    expect(request).not.toHaveProperty('return_last_frame');
  });

  it('enforces Higgsfield mode/reference rules and the total reference cap', () => {
    const settings = buildDefaultSeedanceMasterSettings();
    expect(() => compileHiggsfieldSeedanceRequest({storyboard, production, settings, imageReferences: ['upload-1']}))
      .toThrow(/t2v.*reference/i);
    settings.axes.task = 'r2v';
    const valid = compileHiggsfieldSeedanceRequest({storyboard, production, settings, imageReferences: ['upload-1']});
    expect(valid.mode).toBe('omni_reference');
    expect(valid.image_references).toEqual(['upload-1']);
    expect(() => higgsfieldSeedanceRequestSchema.parse({...valid, image_references: Array.from({length: 51}, (_, i) => `id-${i}`)}))
      .toThrow(/50/);
  });

  it('rejects unsupported first/last-frame mode and invalid reference IDs', () => {
    const settings = buildDefaultSeedanceMasterSettings();
    settings.axes.task = 'fl';
    expect(() => compileHiggsfieldSeedanceRequest({storyboard, production, settings})).toThrow(/first\/last-frame mode/i);
    expect(() => higgsfieldSeedanceRequestSchema.parse({
      prompt: 'x', mode: 'omni_reference', duration: 30, aspect_ratio: '16:9', resolution: '720p', generate_audio: false,
      image_references: ['../../unsafe'],
    })).toThrow();
    const mismatched = buildDefaultSeedanceMasterSettings();
    mismatched.duration = 20;
    expect(() => seedanceMasterSettingsSchema.parse(mismatched)).toThrow(/단계 구조/);
  });

  it('requires extension direction only for video extension', () => {
    const settings = buildDefaultSeedanceMasterSettings();
    settings.axes.task = 'ext';
    expect(() => compileHiggsfieldSeedanceRequest({storyboard, production, settings, videoReferences: ['video-1']}))
      .toThrow(/extension/i);
    settings.extensionMode = 'forward';
    const request = compileHiggsfieldSeedanceRequest({storyboard, production, settings, videoReferences: ['video-1']});
    expect(request).toMatchObject({mode: 'video_extension', extension_mode: 'forward', video_references: ['video-1']});
  });

  it('builds a shell-free Higgsfield CLI argument list without unsupported fields', () => {
    const settings = buildDefaultSeedanceMasterSettings();
    settings.axes.task = 'r2v';
    const request = compileHiggsfieldSeedanceRequest({storyboard, production, settings, imageReferences: ['upload_1', 'upload_2']});
    const args = buildHiggsfieldCliArgs(request);
    expect(args).toEqual(expect.arrayContaining(['generate', 'create', 'seedance_2_5', '--mode', 'omni_reference', '--image-references', 'upload_1', '--image-references', 'upload_2', '--json']));
    expect(args).toEqual(expect.arrayContaining(['--prompt', request.prompt]));
    expect(args.join(' ')).not.toMatch(/output[_-]format|watermark|return[_-]last[_-]frame|adaptive|doubao/i);
  });
});
