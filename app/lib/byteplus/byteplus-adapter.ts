import {z} from 'zod';
import {sha256} from '@/app/lib/workflow/hash';
import {
  assertSeedance25ReferencePolicy,
  compileSeedanceMasterPrompt,
  seedanceMasterSettingsSchema,
  type SeedanceMasterSettings,
} from '@/app/lib/workflow/seedance-master';
import {productionManifestSchema, type ProductionManifest} from '@/app/lib/workflow/production-schema';
import {storyboardSchema, type Storyboard} from '@/app/lib/workflow/schema';

export const BYTEPLUS_ARK_BASE_URL = 'https://ark.ap-southeast.bytepluses.com' as const;
export const BYTEPLUS_CREATE_TASK_URL = `${BYTEPLUS_ARK_BASE_URL}/api/v3/contents/generations/tasks` as const;
export const BYTEPLUS_SEEDANCE_25_MODEL = 'dreamina-seedance-2-5-260628' as const;
export const BYTEPLUS_VIDEO_API_VERSION = 'v3' as const;
export const BYTEPLUS_COMPILER_VERSION = 'byteplus-seedance-2.5/2' as const;

const hex64 = z.string().regex(/^[a-f0-9]{64}$/);
const assetId = z.string().regex(/^[A-Za-z0-9_-]{3,128}$/);
const httpsUrl = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password;
}, 'Transport URL must be credential-free HTTPS.');

export const bytePlusReferenceIdentitySchema = z.object({
  assetId,
  contentSha256: hex64,
  mediaType: z.enum(['image', 'video', 'audio']),
  role: z.enum(['reference_image', 'reference_video', 'reference_audio', 'first_frame', 'last_frame']),
  portraitHandling: z.enum(['no-real-human-face', 'trusted-model-output', 'official-private-portrait', 'direct-real-human-face']),
}).strict();
export type BytePlusReferenceIdentity = z.infer<typeof bytePlusReferenceIdentitySchema>;

const canonicalRequestBase = z.object({
  version: z.literal(1),
  provider: z.literal('byteplus'),
  providerApiVersion: z.literal(BYTEPLUS_VIDEO_API_VERSION),
  compilerVersion: z.literal(BYTEPLUS_COMPILER_VERSION),
  model: z.literal(BYTEPLUS_SEEDANCE_25_MODEL),
  task: z.enum(['t2v', 'r2v', 'edit', 'ext', 'fl']),
  omniReferenceTaskType: z.enum(['reference', 'edit', 'extend']).optional(),
  prompt: z.string().min(1).max(24_000),
  references: z.array(bytePlusReferenceIdentitySchema).max(50),
  generateAudio: z.boolean(),
  ratio: z.enum(['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']),
  duration: z.union([z.number().int().min(4).max(30), z.literal(-1)]),
  resolution: z.enum(['480p', '720p']),
  watermark: z.literal(false),
  returnLastFrame: z.literal(false),
}).strict();

export const bytePlusCanonicalRequestSchema = canonicalRequestBase.superRefine((request, ctx) => {
  const duplicate = request.references.find((candidate, index) => request.references.findIndex((other) => other.assetId === candidate.assetId && other.role === candidate.role) !== index);
  if (duplicate) ctx.addIssue({code: z.ZodIssueCode.custom, path: ['references'], message: `Duplicate reference identity: ${duplicate.assetId}/${duplicate.role}.`});
  const invalidRole = request.references.find((reference) =>
    (reference.mediaType === 'image' && !['reference_image', 'first_frame', 'last_frame'].includes(reference.role)) ||
    (reference.mediaType === 'video' && reference.role !== 'reference_video') ||
    (reference.mediaType === 'audio' && reference.role !== 'reference_audio'));
  if (invalidRole) ctx.addIssue({code: z.ZodIssueCode.custom, path: ['references'], message: `Reference role ${invalidRole.role} does not match ${invalidRole.mediaType}.`});
});
export type BytePlusCanonicalRequest = z.infer<typeof bytePlusCanonicalRequestSchema>;

const textContentSchema = z.object({type: z.literal('text'), text: z.string().min(1).max(24_000)}).strict();
const imageContentSchema = z.object({type: z.literal('image_url'), image_url: z.object({url: httpsUrl}).strict(), role: z.enum(['reference_image', 'first_frame', 'last_frame'])}).strict();
const videoContentSchema = z.object({type: z.literal('video_url'), video_url: z.object({url: httpsUrl}).strict(), role: z.literal('reference_video')}).strict();
const audioContentSchema = z.object({type: z.literal('audio_url'), audio_url: z.object({url: httpsUrl}).strict(), role: z.literal('reference_audio')}).strict();

export const bytePlusCreateTaskRequestSchema = z.object({
  model: z.literal(BYTEPLUS_SEEDANCE_25_MODEL),
  content: z.array(z.union([textContentSchema, imageContentSchema, videoContentSchema, audioContentSchema])).min(1).max(51),
  generate_audio: z.boolean(),
  ratio: z.enum(['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']),
  duration: z.union([z.number().int().min(4).max(30), z.literal(-1)]),
  resolution: z.enum(['480p', '720p']),
  watermark: z.literal(false),
  return_last_frame: z.literal(false),
  omni_reference_task_type: z.enum(['reference', 'edit', 'extend']).optional(),
}).strict();
export type BytePlusCreateTaskRequest = z.infer<typeof bytePlusCreateTaskRequestSchema>;

const bytePlusTaskStatusSchema = z.enum(['queued', 'running', 'cancelled', 'succeeded', 'failed', 'expired']);
const responseContentSchema = z.object({video_url: httpsUrl.optional(), last_frame_url: httpsUrl.optional()}).strict();
const responseErrorSchema = z.object({code: z.string().min(1), message: z.string()}).strict();
const usageSchema = z.object({completion_tokens: z.number().int().nonnegative(), total_tokens: z.number().int().nonnegative()}).strict();
const responseFields = {
  id: z.string().min(1),
  model: z.string().min(1).optional(),
  status: bytePlusTaskStatusSchema.optional(),
  content: responseContentSchema.optional(),
  created_at: z.number().int().nonnegative().optional(),
  updated_at: z.number().int().nonnegative().optional(),
  draft: z.boolean().optional(),
  draft_task_id: z.string().optional(),
  duration: z.number().int().optional(),
  frames: z.number().int().nonnegative().optional(),
  framespersecond: z.number().int().positive().optional(),
  generate_audio: z.boolean().optional(),
  output_format: z.enum(['mp4', 'mov']).optional(),
  priority: z.number().int().optional(),
  ratio: z.string().optional(),
  resolution: z.string().optional(),
  safety_identifier: z.string().optional(),
  seed: z.number().int().optional(),
  service_tier: z.string().optional(),
  execution_expires_after: z.number().int().positive().optional(),
  usage: usageSchema.optional(),
  error: responseErrorSchema.nullable().optional(),
} as const;
export const bytePlusCreateTaskResponseSchema = z.object(responseFields).strict();
export const bytePlusRetrieveTaskResponseSchema = z.object({...responseFields, status: bytePlusTaskStatusSchema}).strict();
export type BytePlusRetrieveTaskResponse = z.infer<typeof bytePlusRetrieveTaskResponseSchema>;

const assertTaskReferences = (task: BytePlusCanonicalRequest['task'], references: BytePlusReferenceIdentity[]): void => {
  const images = references.filter((reference) => reference.mediaType === 'image');
  const videos = references.filter((reference) => reference.mediaType === 'video');
  const audio = references.filter((reference) => reference.mediaType === 'audio');
  assertSeedance25ReferencePolicy(task, images.map((item) => item.assetId), videos.map((item) => item.assetId), audio.map((item) => item.assetId));
  if (references.some((reference) => reference.portraitHandling === 'direct-real-human-face')) {
    throw new Error('Direct real-human portrait references are disabled; use the official private portrait solution and verified consent path.');
  }
  if (task === 'r2v' && references.some((reference) => !reference.role.startsWith('reference_'))) throw new Error('R2V accepts only reference_image, reference_video, or reference_audio roles.');
  if (task === 'edit' || task === 'ext') {
    if (references.length !== 1 || references[0]?.role !== 'reference_video') throw new Error(`${task} requires exactly one reference_video.`);
  }
  if (task === 'fl') {
    const first = references.filter((reference) => reference.role === 'first_frame');
    const last = references.filter((reference) => reference.role === 'last_frame');
    if (references.length < 1 || references.length > 2 || first.length !== 1 || last.length > 1) throw new Error('First/last-frame generation requires one first_frame and at most one last_frame image.');
  }
};

export const compileBytePlusCanonicalRequest = (input: {
  storyboard: Storyboard;
  production: ProductionManifest;
  settings: SeedanceMasterSettings;
  references: BytePlusReferenceIdentity[];
}): BytePlusCanonicalRequest => {
  const storyboard = storyboardSchema.parse(input.storyboard);
  const production = productionManifestSchema.parse(input.production);
  const settings = seedanceMasterSettingsSchema.parse(input.settings);
  const references = input.references.map((reference) => bytePlusReferenceIdentitySchema.parse(reference));
  assertTaskReferences(settings.axes.task, references);
  const request = {
    version: 1 as const,
    provider: 'byteplus' as const,
    providerApiVersion: BYTEPLUS_VIDEO_API_VERSION,
    compilerVersion: BYTEPLUS_COMPILER_VERSION,
    model: BYTEPLUS_SEEDANCE_25_MODEL,
    task: settings.axes.task,
    ...(settings.axes.task === 'r2v' ? {omniReferenceTaskType: 'reference' as const} : {}),
    prompt: compileSeedanceMasterPrompt(storyboard, production, settings),
    references,
    generateAudio: settings.generateAudio,
    ratio: settings.axes.task === 'edit' || settings.axes.task === 'ext' ? 'adaptive' as const : (settings.aspectRatio === 'auto' ? 'adaptive' as const : settings.aspectRatio),
    duration: settings.duration,
    resolution: settings.resolution,
    watermark: false as const,
    returnLastFrame: false as const,
  };
  return bytePlusCanonicalRequestSchema.parse(request);
};

export const computeBytePlusRequestHash = (request: BytePlusCanonicalRequest): Promise<string> =>
  sha256(bytePlusCanonicalRequestSchema.parse(request));

export const materializeBytePlusCreateTaskRequest = async (
  canonicalInput: BytePlusCanonicalRequest,
  resolveTransportUrl: (reference: BytePlusReferenceIdentity) => Promise<string>,
): Promise<BytePlusCreateTaskRequest> => {
  const canonical = bytePlusCanonicalRequestSchema.parse(canonicalInput);
  const content: BytePlusCreateTaskRequest['content'] = [{type: 'text', text: canonical.prompt}];
  for (const reference of canonical.references) {
    const url = httpsUrl.parse(await resolveTransportUrl(reference));
    if (reference.mediaType === 'image') content.push({type: 'image_url', image_url: {url}, role: reference.role as 'reference_image' | 'first_frame' | 'last_frame'});
    if (reference.mediaType === 'video') content.push({type: 'video_url', video_url: {url}, role: 'reference_video'});
    if (reference.mediaType === 'audio') content.push({type: 'audio_url', audio_url: {url}, role: 'reference_audio'});
  }
  return bytePlusCreateTaskRequestSchema.parse({
    model: canonical.model,
    content,
    generate_audio: canonical.generateAudio,
    ratio: canonical.ratio,
    duration: canonical.duration,
    resolution: canonical.resolution,
    watermark: canonical.watermark,
    return_last_frame: canonical.returnLastFrame,
    ...(canonical.omniReferenceTaskType ? {omni_reference_task_type: canonical.omniReferenceTaskType} : {}),
  });
};

export const bytePlusRetrieveTaskUrl = (taskId: string): string => {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(taskId)) throw new Error('Invalid BytePlus task ID.');
  return `${BYTEPLUS_CREATE_TASK_URL}/${encodeURIComponent(taskId)}`;
};
