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

export const transitionSchema = z.object({
  id: z.string().min(1),
  fromMediaId: z.string().min(1),
  toMediaId: z.string().min(1),
  type: z.enum(['none', 'fade', 'wipe', 'slide', 'whip-pan', 'flash', 'blur', 'push', 'zoom']),
  durationSeconds: z.number().min(0).max(3),
});

export const captionCueSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(500),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().positive(),
  preset: z.enum(['clean', 'bold-highlight', 'cinematic', 'shorts']).default('clean'),
  emphasis: z.array(z.string()).default([]),
  safeArea: z.boolean().default(true),
}).refine((cue) => cue.endSeconds > cue.startSeconds, 'Caption end must be after start');

export const workflowStateSchema = z.object({
  storyboard: storyboardSchema.optional(),
  approval: approvalSchema.default({status: 'draft'}),
  higgsfieldAssets: z.array(higgsfieldAssetSchema).default([]),
  transitions: z.array(transitionSchema).default([]),
  captions: z.array(captionCueSchema).default([]),
});

export type Storyboard = z.infer<typeof storyboardSchema>;
export type StoryboardCut = z.infer<typeof storyboardCutSchema>;
export type StoryboardShot = z.infer<typeof storyboardShotSchema>;
export type StoryboardApproval = z.infer<typeof approvalSchema>;
export type HiggsfieldAsset = z.infer<typeof higgsfieldAssetSchema>;
export type TransitionSpec = z.infer<typeof transitionSchema>;
export type CaptionCue = z.infer<typeof captionCueSchema>;
export type WorkflowState = z.infer<typeof workflowStateSchema>;

export const createDefaultWorkflow = (): WorkflowState => ({
  approval: {status: 'draft'},
  higgsfieldAssets: [],
  transitions: [],
  captions: [],
});
