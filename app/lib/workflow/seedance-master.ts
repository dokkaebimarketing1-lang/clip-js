import {z} from 'zod';
import {compileShotPrompt} from './production';
import type {ProductionManifest} from './production-schema';
import type {Storyboard} from './schema';

const axisSchema = z.object({
  task: z.enum(['t2v', 'r2v', 'edit', 'ext', 'fl']),
  extra: z.enum(['none', 'one_click', 'seamless', 'combined']),
  genre: z.enum(['tvc', 'drama', 'brand', 'education', 'ecommerce', 'travel']),
  durationStructure: z.enum(['20s-4stage', '30s-5stage']),
  shotSequence: z.enum(['timestamp', 'shot-number', 'time-point', 'relative-time', 'mixed']),
  dialogueLanguage: z.enum(['ko-seoul', 'en', 'none']),
  voice: z.enum(['soft-slow', 'bright-fast', 'calm-formal', 'excited-fast']),
  emotions: z.array(z.enum(['joy', 'sadness', 'anxiety', 'anger', 'relief'])).max(5),
  emotionFlow: z.enum(['none', 'four-stage']),
  shotSize: z.enum(['wide-medium-close-wide', 'close-medium-wide', 'wide-medium-close', 'face-to-full']),
  timeWeather: z.enum(['none', 'morning', 'noon', 'sunset', 'night', 'rain', 'fog']),
  camera: z.enum(['vlog', 'cinematic', 'one-take', 'fpv', 'handheld-documentary']),
  angle: z.enum(['eye', 'low', 'high', 'top', 'fpv', 'over-shoulder', 'three-quarter']),
  optics: z.array(z.enum(['shallow-depth', 'bokeh', 'flare', 'slow-motion', 'wide', 'fisheye', 'macro'])).max(7),
  composition: z.enum(['none', 'thirds', 'center', 'diagonal', 'over-shoulder', 'high-angle']),
  transition: z.enum(['hard-cut', 'crossfade', 'match-cut', 'seamless', 'zoom']),
  audioLanes: z.array(z.enum(['dialogue', 'sfx', 'ambience', 'music'])).max(4),
  musicGenre: z.enum(['none', 'acoustic', 'orchestra', 'hiphop', 'lounge']),
  fxPresets: z.array(z.enum(['nature', 'city', 'daily', 'machine'])).max(4),
  quality: z.array(z.enum(['cinematic-hd', 'natural-color', 'real-skin', 'warm'])).max(4),
  visualStyle: z.enum(['documentary', 'anime-2d', 'cg-3d', 'cyberpunk', 'retro', 'vlog']),
  styleLock: z.enum(['forward', 'bidirectional', 'reference-image']),
  lighting: z.enum(['golden-hour', 'neon', 'studio', 'natural', 'low-key', 'blue-hour']),
  textGeneration: z.enum(['none', 'slogan', 'subtitle', 'speech-bubble']),
  referenceMaterials: z.array(z.enum(['image-character', 'image-scene', 'image-multi-subject', 'video-action', 'video-effects', 'audio-voice'])).max(6),
  subjectDefinition: z.enum(['single', 'multi-material-single-subject', 'material-per-subject']),
  whiteModel: z.enum(['none', 'coarse', 'detailed']),
  keyframe: z.enum(['none', 'ordered', 'first-last']),
}).strict();

export const seedanceMasterSettingsSchema = z.object({
  axes: axisSchema,
  duration: z.union([z.literal(20), z.literal(30)]),
  aspectRatio: z.enum(['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']),
  resolution: z.enum(['480p', '720p']),
  generateAudio: z.boolean(),
  extensionMode: z.enum(['backward', 'forward']).optional(),
  imageReferenceIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)).max(50).default([]),
  videoReferenceIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)).max(50).default([]),
  audioReferenceIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)).max(50).default([]),
}).strict().superRefine((settings, ctx) => {
  const expected = settings.duration === 20 ? '20s-4stage' : '30s-5stage';
  if (settings.axes.durationStructure !== expected) {
    ctx.addIssue({code: z.ZodIssueCode.custom, path: ['axes', 'durationStructure'], message: '영상 길이와 단계 구조가 일치해야 합니다.'});
  }
});

export type SeedanceMasterSettings = z.infer<typeof seedanceMasterSettingsSchema>;

export const buildDefaultSeedanceMasterSettings = (): SeedanceMasterSettings => ({
  axes: {
    task: 't2v', extra: 'none', genre: 'tvc', durationStructure: '30s-5stage', shotSequence: 'timestamp',
    dialogueLanguage: 'ko-seoul', voice: 'calm-formal', emotions: ['anxiety', 'relief'], emotionFlow: 'four-stage',
    shotSize: 'wide-medium-close-wide', timeWeather: 'none', camera: 'cinematic', angle: 'eye', optics: ['shallow-depth'],
    composition: 'thirds', transition: 'hard-cut', audioLanes: ['dialogue', 'sfx', 'ambience'], musicGenre: 'none', fxPresets: [],
    quality: ['cinematic-hd', 'natural-color', 'real-skin'], visualStyle: 'documentary', styleLock: 'bidirectional',
    lighting: 'natural', textGeneration: 'none', referenceMaterials: [], subjectDefinition: 'single', whiteModel: 'none', keyframe: 'none',
  },
  duration: 30,
  aspectRatio: '16:9',
  resolution: '720p',
  generateAudio: false,
  imageReferenceIds: [],
  videoReferenceIds: [],
  audioReferenceIds: [],
});

export const higgsfieldSeedanceRequestSchema = z.object({
  prompt: z.string().min(1).max(24_000),
  mode: z.enum(['t2v', 'omni_reference', 'video_edit', 'video_extension']),
  duration: z.number().int().min(4).max(30),
  aspect_ratio: z.enum(['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']),
  resolution: z.enum(['480p', '720p']),
  generate_audio: z.boolean(),
  image_references: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)).optional(),
  video_references: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)).optional(),
  audio_references: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)).optional(),
  extension_mode: z.enum(['backward', 'forward']).optional(),
}).strict().superRefine((request, ctx) => {
  const imageCount = request.image_references?.length ?? 0;
  const videoCount = request.video_references?.length ?? 0;
  const audioCount = request.audio_references?.length ?? 0;
  const total = imageCount + videoCount + audioCount;
  if (total > 50) ctx.addIssue({code: z.ZodIssueCode.custom, message: 'Higgsfield accepts at most 50 reference media items in total.'});
  if (request.mode === 't2v' && total > 0) ctx.addIssue({code: z.ZodIssueCode.custom, message: 'Higgsfield t2v mode does not accept reference media.'});
  if (request.mode === 'omni_reference' && total === 0) ctx.addIssue({code: z.ZodIssueCode.custom, message: 'Higgsfield omni_reference mode requires reference media.'});
  if (request.mode === 'video_edit' && videoCount !== 1) ctx.addIssue({code: z.ZodIssueCode.custom, message: 'Higgsfield video_edit mode requires exactly one video reference.'});
  if (request.mode === 'video_extension' && videoCount !== 1) ctx.addIssue({code: z.ZodIssueCode.custom, message: 'Higgsfield video_extension mode requires exactly one video reference.'});
  if (request.mode === 'video_extension' && !request.extension_mode) ctx.addIssue({code: z.ZodIssueCode.custom, message: 'Higgsfield video_extension mode requires extension_mode.'});
  if (request.mode !== 'video_extension' && request.extension_mode) ctx.addIssue({code: z.ZodIssueCode.custom, message: 'extension_mode is only accepted for video_extension.'});
});

export type HiggsfieldSeedanceRequest = z.infer<typeof higgsfieldSeedanceRequestSchema>;

export const buildHiggsfieldCliArgs = (requestInput: HiggsfieldSeedanceRequest): string[] => {
  const request = higgsfieldSeedanceRequestSchema.parse(requestInput);
  const args = ['generate', 'create', 'seedance_2_5', '--prompt', request.prompt, '--mode', request.mode, '--duration', String(request.duration), '--aspect_ratio', request.aspect_ratio, '--resolution', request.resolution, '--generate_audio', String(request.generate_audio)];
  request.image_references?.forEach((id) => args.push('--image-references', id));
  request.video_references?.forEach((id) => args.push('--video-references', id));
  request.audio_references?.forEach((id) => args.push('--audio-references', id));
  if (request.extension_mode) args.push('--extension_mode', request.extension_mode);
  args.push('--json');
  return args;
};

const modeForTask = (task: SeedanceMasterSettings['axes']['task']): HiggsfieldSeedanceRequest['mode'] => {
  if (task === 't2v') return 't2v';
  if (task === 'r2v') return 'omni_reference';
  if (task === 'edit') return 'video_edit';
  if (task === 'ext') return 'video_extension';
  throw new Error('Higgsfield Seedance 2.5 does not expose first/last-frame mode.');
};

const axisLabels: Partial<Record<keyof SeedanceMasterSettings['axes'], Record<string, string>>> = {
  extra: {none: '不使用', one_click: '一键成片', seamless: '无缝转场', combined: '组合能力'},
  genre: {tvc: '高端广告片', drama: '短剧', brand: '品牌故事', education: '教育视频', ecommerce: '电商视频', travel: '旅行Vlog'},
  durationStructure: {'20s-4stage': '20秒四阶段结构', '30s-5stage': '30秒五阶段结构'},
  shotSequence: {timestamp: '连续且不重叠的整数秒时间区间', 'shot-number': '镜头编号', 'time-point': '指定秒数事件', 'relative-time': '相对时间事件', mixed: '镜头编号与时间区间并用'},
  dialogueLanguage: {'ko-seoul': '韩语，自然的首尔口音', en: '美式英语', none: '无台词'},
  voice: {'soft-slow': '温柔、缓慢、口语化', 'bright-fast': '明亮、稍快、有活力', 'calm-formal': '沉稳、均匀、正式', 'excited-fast': '兴奋、快速、饱满'},
  emotions: {joy: '喜悦的可见肢体反应', sadness: '悲伤的可见肢体反应', anxiety: '紧张不安的呼吸与视线', anger: '愤怒的肌肉与手部反应', relief: '释然的呼吸与肩部放松'},
  emotionFlow: {none: '保持单一情绪', 'four-stage': '开始→触发→即时反应→最终转变'},
  shotSize: {'wide-medium-close-wide': '全景→中景→特写→全景', 'close-medium-wide': '特写→中景→全景', 'wide-medium-close': '全景→中景→特写', 'face-to-full': '头像→胸像→半身→全身'},
  timeWeather: {none: '按故事板', morning: '清晨柔光', noon: '正午强光', sunset: '傍晚金色夕阳', night: '夜晚人工照明', rain: '雨天湿润反光', fog: '雾天朦胧氛围'},
  camera: {vlog: '日常跟拍', cinematic: '电影感运镜', 'one-take': '一镜到底', fpv: '第一人称', 'handheld-documentary': '手持纪录片'},
  angle: {eye: '平视', low: '低机位仰视', high: '高机位俯视', top: '顶面视角', fpv: '第一人称', 'over-shoulder': '过肩视角', 'three-quarter': '四分之三侧视角'},
  optics: {'shallow-depth': '浅景深', bokeh: '圆形散景', flare: '电影感镜头光晕', 'slow-motion': '慢动作', wide: '广角镜头', fisheye: '鱼眼镜头', macro: '微距摄影'},
  composition: {none: '按故事板', thirds: '三分构图', center: '中心构图', diagonal: '对角线构图', 'over-shoulder': '过肩构图', 'high-angle': '高角度俯视构图'},
  transition: {'hard-cut': '硬切', crossfade: '交叉溶解', 'match-cut': '匹配剪辑', seamless: '无缝转场', zoom: '推拉变焦转场'},
  audioLanes: {dialogue: '对话{}', sfx: '音效<>', ambience: '环境音', music: '音乐()'},
  musicGenre: {none: '无背景音乐', acoustic: '轻快原声吉他', orchestra: '管弦乐', hiphop: '节奏感强的嘻哈', lounge: '轻松休息室音乐'},
  fxPresets: {nature: '海浪、鸟鸣、风声', city: '车辆、施工、人群', daily: '电话、脚步、开门', machine: '电子提示音、马达'},
  quality: {'cinematic-hd': '高清、细节丰富、电影质感', 'natural-color': '色彩自然、光影柔和', 'real-skin': '真实皮肤质感', warm: '暖色调'},
  visualStyle: {documentary: '真人实拍彩色电影，写实照片级质感', 'anime-2d': '2D动画', 'cg-3d': '3D CG动画', cyberpunk: '赛博朋克', retro: '复古胶片', vlog: '自然Vlog'},
  styleLock: {forward: '正向风格固定', bidirectional: '正向描述并严格排除相反风格', 'reference-image': '以参考媒体风格为准'},
  lighting: {'golden-hour': '黄金时刻暖光', neon: '霓虹灯光', studio: '摄影棚柔光', natural: '柔和自然光', 'low-key': '低光照暗调', 'blue-hour': '蓝调时刻'},
  textGeneration: {none: '不生成画面文字', slogan: '生成广告文案', subtitle: '生成同步字幕', 'speech-bubble': '生成角色气泡台词'},
  referenceMaterials: {'image-character': '人物外貌与服装图片', 'image-scene': '场景空间与光线图片', 'image-multi-subject': '多主体分别绑定图片', 'video-action': '动作与运镜视频', 'video-effects': '特效与风格视频', 'audio-voice': '角色音色音频'},
  subjectDefinition: {single: '单一主角', 'multi-material-single-subject': '一个主角使用多份材料', 'material-per-subject': '每个主角分别绑定材料'},
  whiteModel: {none: '不使用白模', coarse: '白模仅固定动作路径与机位', detailed: '白模固定结构动作并重渲染材质'},
  keyframe: {none: '不使用关键帧', ordered: '按图片编号顺序作为关键帧', 'first-last': '首尾关键帧'},
};

const axisValue = (key: keyof SeedanceMasterSettings['axes'], value: string): string => axisLabels[key]?.[value] ?? value;

const summarizeAxis = (settings: SeedanceMasterSettings): string => {
  const {axes} = settings;
  const list = (key: keyof typeof axes, values: readonly string[]) => values.map((value) => axisValue(key, value)).join('、') || '无';
  return [
    `【生成目标】${axisValue('genre', axes.genre)}；${settings.duration}秒；${axisValue('durationStructure', axes.durationStructure)}；${axisValue('shotSequence', axes.shotSequence)}；额外能力：${axisValue('extra', axes.extra)}。`,
    `【人物与情绪】台词语言：${axisValue('dialogueLanguage', axes.dialogueLanguage)}；语气：${axisValue('voice', axes.voice)}；情绪：${list('emotions', axes.emotions)}；情绪流：${axisValue('emotionFlow', axes.emotionFlow)}。`,
    `【镜头与风格】景别：${axisValue('shotSize', axes.shotSize)}；时间天气：${axisValue('timeWeather', axes.timeWeather)}；${axisValue('camera', axes.camera)}；机位：${axisValue('angle', axes.angle)}；光学：${list('optics', axes.optics)}；构图：${axisValue('composition', axes.composition)}；转场：${axisValue('transition', axes.transition)}。每个镜头只使用一种运镜。`,
    `【声音总则】声道：${list('audioLanes', axes.audioLanes)}；音乐：${axisValue('musicGenre', axes.musicGenre)}；效果音：${list('fxPresets', axes.fxPresets)}。`,
    `【画质·风格·约束】${list('quality', axes.quality)}；${axisValue('visualStyle', axes.visualStyle)}；${axisValue('styleLock', axes.styleLock)}；${axisValue('lighting', axes.lighting)}；${axisValue('textGeneration', axes.textGeneration)}。`,
    `【参考策略】${list('referenceMaterials', axes.referenceMaterials)}；${axisValue('subjectDefinition', axes.subjectDefinition)}；${axisValue('whiteModel', axes.whiteModel)}；${axisValue('keyframe', axes.keyframe)}。`,
  ].join('\n');
};

const compileMasterPrompt = (storyboard: Storyboard, production: ProductionManifest, settings: SeedanceMasterSettings): string => {
  const taskLabel: Record<HiggsfieldSeedanceRequest['mode'], string> = {
    t2v: '文生视频', omni_reference: '参考生视频', video_edit: '视频编辑', video_extension: '视频延长',
  };
  const mode = modeForTask(settings.axes.task);
  const stages = production.shotSpecs.map((spec) => {
    const cut = storyboard.cuts.find((candidate) => candidate.id === spec.cutId);
    const shot = cut?.shots.find((candidate) => candidate.id === spec.shotId);
    if (!cut || !shot) throw new Error(`Shot ${spec.cutId}/${spec.shotId} is missing from the approved storyboard.`);
    const absoluteStart = cut.absoluteStartSeconds + shot.startSeconds;
    const absoluteEnd = absoluteStart + spec.durationSeconds;
    return `【阶段 ${absoluteStart.toFixed(3)}–${absoluteEnd.toFixed(3)}秒】\n${compileShotPrompt(production, spec.id)}`;
  });
  if (!stages.length) throw new Error('Seedance master prompt requires at least one production shot.');
  const prompt = [
    `【任务类型】${taskLabel[mode]}`,
    `【项目】${storyboard.title}`,
    summarizeAxis(settings),
    ...stages,
    '【总约束】保持人物、服装、道具、场景、光线、数量全程一致。无多余人物，无畸形手脚，无水印，无Logo。',
  ].join('\n\n');
  return prompt;
};

export const compileHiggsfieldSeedanceRequest = (input: {
  storyboard: Storyboard;
  production: ProductionManifest;
  settings: SeedanceMasterSettings;
  imageReferences?: string[];
  videoReferences?: string[];
  audioReferences?: string[];
}): HiggsfieldSeedanceRequest => {
  const settings = seedanceMasterSettingsSchema.parse(input.settings);
  const mode = modeForTask(settings.axes.task);
  const request: Record<string, unknown> = {
    prompt: compileMasterPrompt(input.storyboard, input.production, settings),
    mode,
    duration: settings.duration,
    aspect_ratio: settings.aspectRatio,
    resolution: settings.resolution,
    generate_audio: settings.generateAudio,
  };
  const imageReferences = input.imageReferences ?? settings.imageReferenceIds;
  const videoReferences = input.videoReferences ?? settings.videoReferenceIds;
  const audioReferences = input.audioReferences ?? settings.audioReferenceIds;
  if (imageReferences.length) request.image_references = imageReferences;
  if (videoReferences.length) request.video_references = videoReferences;
  if (audioReferences.length) request.audio_references = audioReferences;
  if (settings.extensionMode) request.extension_mode = settings.extensionMode;
  return higgsfieldSeedanceRequestSchema.parse(request);
};
