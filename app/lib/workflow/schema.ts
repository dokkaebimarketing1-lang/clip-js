import {z} from 'zod';

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
}).refine((cut) => cut.absoluteEndSeconds > cut.absoluteStartSeconds, 'Cut end must be after start');

export const storyboardSchema = z.object({
  version: z.string().min(1),
  title: z.string().min(1),
  noBgm: z.literal(true),
  cuts: z.array(storyboardCutSchema).min(1),
});

export const approvalSchema = z.object({
  status: z.enum(['draft', 'approved', 'invalidated']),
  storyboardHash: z.string().optional(),
  approvedAt: z.string().datetime().optional(),
  approvedBy: z.string().optional(),
  signature: z.string().optional(),
});

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

export const workflowStateSchema = z.object({
  storyboard: storyboardSchema.optional(),
  approval: approvalSchema.default({status: 'draft'}),
  higgsfieldAssets: z.array(higgsfieldAssetSchema).default([]),
  transitions: z.array(transitionSchema).default([]),
  effects: z.array(effectSpecSchema).max(1000).default([]),
  captions: z.array(captionCueSchema).max(5000).default([]),
});

export type Storyboard = z.infer<typeof storyboardSchema>;
export type StoryboardCut = z.infer<typeof storyboardCutSchema>;
export type StoryboardShot = z.infer<typeof storyboardShotSchema>;
export type StoryboardApproval = z.infer<typeof approvalSchema>;
export type HiggsfieldAsset = z.infer<typeof higgsfieldAssetSchema>;
export type TransitionSpec = z.infer<typeof transitionSchema>;
export type EffectType = z.infer<typeof effectTypeSchema>;
export type EffectSpec = z.infer<typeof effectSpecSchema>;
export type CaptionKind = z.infer<typeof captionKindSchema>;
export type CaptionPreset = z.infer<typeof captionPresetSchema>;
export type CaptionPosition = z.infer<typeof captionPositionSchema>;
export type CaptionWordTiming = z.infer<typeof captionWordTimingSchema>;
export type CaptionCue = z.infer<typeof captionCueSchema>;
export type WorkflowState = z.infer<typeof workflowStateSchema>;

export const createDefaultWorkflow = (): WorkflowState => ({
  approval: {status: 'draft'},
  higgsfieldAssets: [],
  transitions: [],
  effects: [],
  captions: [],
});
