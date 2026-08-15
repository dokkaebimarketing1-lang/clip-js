import {z} from 'zod';
import {createDefaultProductionManifest, productionManifestSchema} from './production-schema';
import {buildDefaultSeedanceMasterSettings, seedanceMasterSettingsSchema} from './seedance-master';
export * from './production-schema';
export * from './seedance-master';

export const elementTransformSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  rotation: z.number().finite(),
  scale: z.number().finite().positive(),
}).strict();

export const shapeElementSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.enum(['rect', 'circle', 'line']),
  positionStart: z.number().finite().nonnegative(),
  positionEnd: z.number().finite().positive(),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  color: z.string().min(1).max(128),
  opacity: z.number().finite().min(0).max(100),
  zIndex: z.number().finite(),
  transform: elementTransformSchema.optional(),
  rotation: z.number().finite().optional(),
}).strict().refine((shape) => shape.positionEnd > shape.positionStart, 'Shape range must have positive duration.');

export const normalizedCropSchema = z.object({
  left: z.number().finite().min(0).max(1),
  top: z.number().finite().min(0).max(1),
  width: z.number().finite().positive().max(1),
  height: z.number().finite().positive().max(1),
}).strict().superRefine((crop, context) => {
  if (crop.left + crop.width > 1) {
    context.addIssue({code: z.ZodIssueCode.custom, path: ['width'], message: 'Crop must stay within horizontal media bounds.'});
  }
  if (crop.top + crop.height > 1) {
    context.addIssue({code: z.ZodIssueCode.custom, path: ['height'], message: 'Crop must stay within vertical media bounds.'});
  }
});

export const storyboardShotSchema = z.object({
  id: z.string().min(1),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  startFrame: z.string().min(1),
  endFrame: z.string().min(1),
  camera: z.string().min(1),
  action: z.string().min(1),
  dialogue: z.string().default('—'),
  sfx: z.string().default('—'),
}).refine((shot) => shot.endSeconds > shot.startSeconds, 'Shot end must be after start');

export const storyboardCutSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  absoluteStartSeconds: z.number().nonnegative(),
  absoluteEndSeconds: z.number().positive(),
  shots: z.array(storyboardShotSchema).min(1),
  sheetUrl: z.string().url().optional(),
  startFrameAssetId: z.string().regex(/^ga_[a-f0-9]{32}$/).optional(),
  endFrameAssetId: z.string().regex(/^ga_[a-f0-9]{32}$/).optional(),
  previewAssetId: z.string().regex(/^ga_[a-f0-9]{32}$/).optional(),
  generatedTakeIds: z.array(z.string().min(1).max(128)).max(100).optional(),
  characterIds: z.array(z.string().regex(/^CHAR\d{2}$/)).max(10).optional(),
}).refine((cut) => cut.absoluteEndSeconds > cut.absoluteStartSeconds, 'Cut end must be after start');

export const storyboardSchema = z.object({
  version: z.string().min(1),
  title: z.string().min(1),
  noBgm: z.literal(true),
  characterReferenceIds: z.array(z.string().min(1).max(256)).min(1).max(10).optional(),
  styleBibleHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  cuts: z.array(storyboardCutSchema).min(1),
});

// ── VLOG 파이프라인 8단계 신규 스키마 (PR #15 위에 추가) ──
// ② 인터뷰 결과: 한 문장 → LLM 질의응답 → 구조화 브리프
export const interviewBriefSchema = z.object({
  subject: z.string().min(1).max(200),
  action: z.string().min(1).max(200),
  durationSeconds: z.union([z.literal(20), z.literal(30)]),
  tone: z.string().min(1).max(200).default('자연스러운 일상'),
  characterName: z.string().min(1).max(80).optional(),
  characterBreed: z.string().min(1).max(80).optional(),
  greetingLine: z.string().min(1).max(300).default(''),
  extraNotes: z.string().max(1000).optional(),
});

// ④ 캐릭터 시트: 콘티 속 주체를 시각 자산으로 분리
export const characterSheetSchema = z.object({
  id: z.string().regex(/^CHAR\d{2}$/).optional(),
  name: z.string().min(1).max(80),
  breed: z.string().min(1).max(80).optional(),
  palette: z.object({
    dominant: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#cccccc'),
    secondary: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#888888'),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#ffd43b'),
  }).default({dominant: '#cccccc', secondary: '#888888', accent: '#ffd43b'}),
  visualTags: z.array(z.string().max(40)).max(20).default([]),
  referenceImageId: z.string().min(1).max(256).optional(),
  referenceStyleHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  styleReferenceImageIds: z.array(z.string().regex(/^ga_[a-f0-9]{32}$/)).max(14).optional(),
});

export const styleBibleSchema = z.object({
  anchorReferenceImageId: z.string().regex(/^ga_[a-f0-9]{32}$/).optional(),
  anchorContentSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  visualMedium: z.string().min(1).max(120),
  realism: z.string().min(1).max(120),
  renderLanguage: z.string().min(1).max(240),
  proportionRules: z.string().min(1).max(240),
  lighting: z.string().min(1).max(240),
  lensAndDepth: z.string().min(1).max(240),
  background: z.string().min(1).max(240),
  textureAndColor: z.string().min(1).max(240),
  negativeConstraints: z.array(z.string().min(1).max(120)).min(1).max(20),
}).strict();

export const approvalStatusSchema = z.enum(['draft', 'approved', 'invalidated']);

const approvalAuditSchema = z.object({
  status: approvalStatusSchema,
  signatureVersion: z.literal(1).optional(),
  signingKeyId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  approvedAt: z.string().datetime().optional(),
  approvedBy: z.string().min(1).max(128).optional(),
  signature: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

export const legacyApprovalSchema = approvalAuditSchema.extend({
  storyboardHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  productionHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  seedanceMasterHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

export const creativeApprovalSchema = approvalAuditSchema.extend({
  storyboardHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  characterSheetHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

export const generationApprovalSchema = approvalAuditSchema.extend({
  authorizationVersion: z.literal(1).optional(),
  projectId: z.string().min(1).max(128).optional(),
  generationBlueprintHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  storyboardHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  productionInputHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  seedanceMasterHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  attemptId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
  provider: z.enum(['byteplus', 'fake', 'higgsfield']).optional(),
  model: z.string().min(1).max(200).optional(),
  providerApiVersion: z.string().min(1).max(64).optional(),
  compilerVersion: z.string().min(1).max(64).optional(),
  policyVersion: z.string().min(1).max(64).optional(),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).superRefine((approval, ctx) => {
  if (approval.status !== 'approved') return;
  const required = ['authorizationVersion', 'projectId', 'generationBlueprintHash', 'storyboardHash', 'productionInputHash', 'seedanceMasterHash', 'attemptId', 'provider', 'model', 'providerApiVersion', 'compilerVersion', 'policyVersion', 'requestHash', 'approvedAt', 'approvedBy'] as const;
  required.forEach((field) => {
    if (approval[field] === undefined) ctx.addIssue({code: z.ZodIssueCode.custom, path: [field], message: `Approved generation authorization requires ${field}.`});
  });
});

export const releaseApprovalSchema = approvalAuditSchema.extend({
  renderInputHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

/** @deprecated Read only at the v2 → v3 migration boundary. */
export const approvalSchema = legacyApprovalSchema;

export const higgsfieldAssetSchema = z.object({
  id: z.string().min(1),
  provider: z.literal('higgsfield'),
  model: z.string().min(1),
  jobId: z.string().optional(),
  url: z.string().url(),
  cutId: z.string().min(1),
  shotId: z.string().min(1),
  role: z.enum(['start', 'end', 'clip', 'audio', 'storyboard-sheet']),
  durationSeconds: z.number().positive().optional(),
});

export const transitionTypeSchema = z.enum([
  'none', 'fade', 'wipe', 'slide', 'whip-pan', 'flash', 'blur', 'push', 'zoom',
  'dreamy-zoom', 'film-burn', 'linear-blur',
  'ripple', 'crosswarp', 'dissolve', 'cross-zoom',
]);

export const transitionSchema = z.object({
  id: z.string().min(1),
  fromMediaId: z.string().min(1),
  toMediaId: z.string().min(1),
  type: transitionTypeSchema,
  provider: z.enum(['native', 'remotion', 'gl-transitions']).default('native'),
  durationSeconds: z.number().min(0).max(3),
});

export const effectTypeSchema = z.enum([
  'blur',
  'chromatic-aberration',
  'vignette',
  'noise',
  'pixelate',
  'glow',
]);

export const effectSpecSchema = z.object({
  id: z.string().min(1),
  targetMediaId: z.string().min(1),
  type: effectTypeSchema,
  provider: z.literal('remotion').default('remotion'),
  intensity: z.number().min(0).max(1),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
}).refine((effect) => effect.endSeconds > effect.startSeconds, 'Effect end must be after start');

export const captionKindSchema = z.enum(['dialogue', 'effect', 'variety']);
export const captionPresetSchema = z.enum([
  'clean', 'bold-highlight', 'cinematic', 'shorts',
  'dialogue-clean', 'dialogue-speaker', 'dialogue-cinematic',
  'word-highlight', 'karaoke', 'typewriter', 'bounce', 'glow', 'impact',
  'variety-sticker', 'variety-shock', 'variety-shake', 'reaction', 'thought', 'name-tag', 'quote-card',
]);
export const captionPositionSchema = z.enum(['top', 'center', 'bottom', 'lower-third']);
export const captionWordTimingSchema = z.object({
  text: z.string().min(1).max(100),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
}).refine((word) => word.endMs > word.startMs, 'Caption word end must be after start');

const captionPresetsByKind: Record<z.infer<typeof captionKindSchema>, ReadonlySet<string>> = {
  dialogue: new Set(['clean', 'bold-highlight', 'cinematic', 'shorts', 'dialogue-clean', 'dialogue-speaker', 'dialogue-cinematic']),
  effect: new Set(['word-highlight', 'karaoke', 'typewriter', 'bounce', 'glow', 'impact']),
  variety: new Set(['variety-sticker', 'variety-shock', 'variety-shake', 'reaction', 'thought', 'name-tag', 'quote-card']),
};

export const captionCueSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(500),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  kind: captionKindSchema.default('dialogue'),
  preset: captionPresetSchema.default('clean'),
  speaker: z.string().min(1).max(80).optional(),
  position: captionPositionSchema.default('bottom'),
  intensity: z.number().min(0).max(1).default(0.5),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#ffd43b'),
  fontFamily: z.literal('Noto Sans KR Variable').default('Noto Sans KR Variable'),
  wordTimings: z.array(captionWordTimingSchema).max(200).default([]),
  emphasis: z.array(z.string()).default([]),
  safeArea: z.boolean().default(true),
}).superRefine((cue, ctx) => {
  if (cue.endSeconds <= cue.startSeconds) ctx.addIssue({code: z.ZodIssueCode.custom, message: 'Caption end must be after start'});
  if (!captionPresetsByKind[cue.kind].has(cue.preset)) ctx.addIssue({code: z.ZodIssueCode.custom, path: ['preset'], message: 'Caption preset is not allowed for this caption kind'});
  const startMs = Math.round(cue.startSeconds * 1000);
  const endMs = Math.round(cue.endSeconds * 1000);
  cue.wordTimings.forEach((word, index) => {
    if (word.startMs < startMs || word.endMs > endMs) ctx.addIssue({code: z.ZodIssueCode.custom, path: ['wordTimings', index], message: 'Caption word timing must stay within cue range'});
  });
});

const timedMediaLaneSchema = z.object({
  id: z.string().min(1).max(128),
  mediaId: z.string().min(1).max(128),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  volume: z.number().min(0).max(100),
}).refine((lane) => lane.endSeconds > lane.startSeconds, 'Audio lane end must be after start');

export const postProductionSchema = z.object({
  sourceAudioPolicy: z.enum(['mute', 'duck', 'keep']).default('mute'),
  dialogueCues: z.array(z.object({
    id: z.string().min(1).max(128), text: z.string().min(1).max(1000), language: z.literal('ko-KR'),
    speaker: z.string().min(1).max(128), mediaId: z.string().min(1).max(128),
    startSeconds: z.number().nonnegative(), endSeconds: z.number().positive(),
  }).refine((cue) => cue.endSeconds > cue.startSeconds, 'Dialogue cue end must be after start')).max(500).default([]),
  ambience: z.array(timedMediaLaneSchema).max(500).default([]),
  sfx: z.array(timedMediaLaneSchema).max(1000).default([]),
  bgm: z.array(timedMediaLaneSchema).max(100).default([]),
  appUiOverlays: z.array(z.object({
    id: z.string().min(1).max(128), screenName: z.string().min(1).max(200),
    source: z.enum(['verified-app-capture', 'vector-reconstruction']),
    mediaId: z.string().min(1).max(128),
    startSeconds: z.number().nonnegative(), endSeconds: z.number().positive(),
    accessibilityLabel: z.string().min(1).max(500),
  }).refine((overlay) => overlay.endSeconds > overlay.startSeconds, 'App UI overlay end must be after start')).max(200).default([]),
  endingCard: z.object({
    brandName: z.string().min(1).max(200), cta: z.string().min(1).max(500),
    brandTextElementId: z.string().min(1).max(128), ctaTextElementId: z.string().min(1).max(128),
    startSeconds: z.number().nonnegative(), endSeconds: z.number().positive(),
  }).refine((card) => card.endSeconds > card.startSeconds, 'Ending card end must be after start').optional(),
  releaseChecklist: z.object({
    koreanDialogueReviewed: z.boolean().default(false), captionsVerified: z.boolean().default(false),
    audioMixReviewed: z.boolean().default(false), appUiVerified: z.boolean().default(false), ctaVerified: z.boolean().default(false),
  }).default({}),
}).default({});

const draftApprovals = () => ({
  creativeApproval: {status: 'draft' as const},
  generationApproval: {status: 'draft' as const},
  releaseApproval: {status: 'draft' as const},
});

const migrateLegacyWorkflowApprovals = (input: unknown): unknown => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const workflow = {...input as Record<string, unknown>};
  const hasV3Approvals = workflow.creativeApproval !== undefined
    || workflow.generationApproval !== undefined
    || workflow.releaseApproval !== undefined;
  if (!hasV3Approvals) {
    // Any legacy approval payload is untrusted in v3, even when malformed.
    // Its mere presence means an older approval existed and must fail closed.
    const status = workflow.approval === undefined ? 'draft' : 'invalidated';
    workflow.creativeApproval = {status};
    workflow.generationApproval = {status};
    workflow.releaseApproval = {status};
  }
  for (const key of ['creativeApproval', 'releaseApproval'] as const) {
    const approval = workflow[key];
    if (approval && typeof approval === 'object' && !Array.isArray(approval)) {
      const record = approval as Record<string, unknown>;
      if (record.status === 'approved' && (record.signatureVersion !== 1 || typeof record.signingKeyId !== 'string')) {
        workflow[key] = {...record, status: 'invalidated'};
      }
    }
  }
  const generation = workflow.generationApproval;
  if (generation && typeof generation === 'object' && !Array.isArray(generation)) {
    const record = generation as Record<string, unknown>;
    const currentFields = ['signatureVersion', 'signingKeyId', 'authorizationVersion', 'projectId', 'generationBlueprintHash', 'storyboardHash', 'productionInputHash', 'seedanceMasterHash', 'attemptId', 'provider', 'model', 'providerApiVersion', 'compilerVersion', 'policyVersion', 'requestHash', 'approvedAt', 'approvedBy', 'signature'];
    if (record.status === 'approved' && currentFields.some((field) => record[field] === undefined)) {
      workflow.generationApproval = {...record, status: 'invalidated'};
      const release = workflow.releaseApproval;
      if (release && typeof release === 'object' && !Array.isArray(release)) {
        const releaseRecord = release as Record<string, unknown>;
        workflow.releaseApproval = {...releaseRecord, status: releaseRecord.status === 'draft' ? 'draft' : 'invalidated'};
      }
    }
  }
  const sheets = Array.isArray(workflow.characterSheets)
    ? workflow.characterSheets
    : workflow.characterSheet
      ? [workflow.characterSheet]
      : [];
  if (sheets.length > 0) {
    const normalizedSheets = sheets.map((sheet, index) => ({
      ...(sheet as Record<string, unknown>),
      id: typeof (sheet as Record<string, unknown>).id === 'string'
        ? (sheet as Record<string, unknown>).id
        : `CHAR${String(index + 1).padStart(2, '0')}`,
    }));
    workflow.characterSheets = normalizedSheets;
    workflow.characterSheet = normalizedSheets[0];
  }
  delete workflow.approval;
  return workflow;
};

const workflowStateV3Schema = z.object({
  planningStatus: z.enum(['draft', 'approved']).default('approved'),
  interviewBrief: interviewBriefSchema.optional(),
  styleBible: styleBibleSchema.optional(),
  styleBibleHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  characterSheet: characterSheetSchema.optional(),
  characterSheets: z.array(characterSheetSchema).min(1).max(10).optional(),
  storyboard: storyboardSchema.optional(),
  creativeApproval: creativeApprovalSchema.default({status: 'draft'}),
  generationApproval: generationApprovalSchema.default({status: 'draft'}),
  releaseApproval: releaseApprovalSchema.default({status: 'draft'}),
  higgsfieldAssets: z.array(higgsfieldAssetSchema).default([]),
  transitions: z.array(transitionSchema).default([]),
  effects: z.array(effectSpecSchema).max(1000).default([]),
  captions: z.array(captionCueSchema).max(5000).default([]),
  postProduction: postProductionSchema,
  production: productionManifestSchema.default(() => createDefaultProductionManifest()),
  seedanceMaster: seedanceMasterSettingsSchema.default(() => buildDefaultSeedanceMasterSettings()),
});

export const workflowStateSchema = z.preprocess(migrateLegacyWorkflowApprovals, workflowStateV3Schema);

export type Storyboard = z.infer<typeof storyboardSchema>;
export type StoryboardCut = z.infer<typeof storyboardCutSchema>;
export type StoryboardShot = z.infer<typeof storyboardShotSchema>;
export type LegacyStoryboardApproval = z.infer<typeof legacyApprovalSchema>;
/** @deprecated Use CreativeApproval or GenerationApproval. */
export type StoryboardApproval = LegacyStoryboardApproval;
export type CreativeApproval = z.infer<typeof creativeApprovalSchema>;
export type GenerationApproval = z.infer<typeof generationApprovalSchema>;
export type ReleaseApproval = z.infer<typeof releaseApprovalSchema>;
export type HiggsfieldAsset = z.infer<typeof higgsfieldAssetSchema>;
export type InterviewBrief = z.infer<typeof interviewBriefSchema>;
export type CharacterSheet = z.infer<typeof characterSheetSchema>;
export type StyleBible = z.infer<typeof styleBibleSchema>;
export type TransitionSpec = z.infer<typeof transitionSchema>;
export type EffectType = z.infer<typeof effectTypeSchema>;
export type EffectSpec = z.infer<typeof effectSpecSchema>;
export type CaptionKind = z.infer<typeof captionKindSchema>;
export type CaptionPreset = z.infer<typeof captionPresetSchema>;
export type CaptionPosition = z.infer<typeof captionPositionSchema>;
export type CaptionWordTiming = z.infer<typeof captionWordTimingSchema>;
export type CaptionCue = z.infer<typeof captionCueSchema>;
export type PostProduction = z.infer<typeof postProductionSchema>;
export type WorkflowState = z.infer<typeof workflowStateSchema>;

export const createDefaultWorkflow = (): WorkflowState => ({
  ...draftApprovals(),
  planningStatus: 'draft',
  interviewBrief: undefined,
  styleBible: undefined,
  styleBibleHash: undefined,
  characterSheet: undefined,
  characterSheets: undefined,
  higgsfieldAssets: [],
  transitions: [],
  effects: [],
  captions: [],
  postProduction: postProductionSchema.parse({}),
  production: createDefaultProductionManifest(),
  seedanceMaster: buildDefaultSeedanceMasterSettings(),
});
