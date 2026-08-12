import {z} from 'zod';

const hex64 = z.string().regex(/^[a-f0-9]{64}$/);
export const generatedAssetIdSchema = z.string().regex(/^ga_[a-f0-9]{32}$/);

export const verifiedVideoMetadataSchema = z.object({
  container: z.literal('mp4'),
  videoCodec: z.enum(['h264', 'hevc', 'av1', 'vp9']),
  audioCodec: z.enum(['aac', 'opus']).optional(),
  width: z.number().int().min(16).max(8192),
  height: z.number().int().min(16).max(8192),
  fps: z.number().positive().max(240),
  durationSeconds: z.number().positive().max(3_600),
  videoStreams: z.literal(1),
  audioStreams: z.number().int().min(0).max(1),
  subtitleStreams: z.literal(0).default(0),
  dataStreams: z.literal(0).default(0),
  attachmentStreams: z.literal(0).default(0),
}).strict();

export const verifiedAudioMetadataSchema = z.object({
  container: z.enum(['mp3', 'wav', 'm4a', 'webm']),
  audioCodec: z.enum(['mp3', 'pcm_s16le', 'aac', 'opus']),
  durationSeconds: z.number().positive().max(3_600),
  videoStreams: z.literal(0),
  audioStreams: z.literal(1),
}).strict();

export const verifiedImageMetadataSchema = z.object({
  format: z.enum(['png', 'jpeg', 'webp']),
  width: z.number().int().min(16).max(8192),
  height: z.number().int().min(16).max(8192),
}).strict();

export const managedMediaMetadataSchema = z.union([
  verifiedVideoMetadataSchema,
  verifiedAudioMetadataSchema,
  verifiedImageMetadataSchema,
]);

export const generatedAssetSchema = z.object({
  version: z.literal(1),
  id: generatedAssetIdSchema,
  state: z.literal('ready'),
  assetKind: z.enum(['generated-video', 'managed-media']).default('generated-video'),
  projectId: z.string().min(1).max(256),
  requestKey: hex64,
  providerJobId: z.string().min(1).max(512).optional(),
  contentSha256: hex64,
  byteLength: z.number().int().positive(),
  mimeType: z.enum([
    'video/mp4', 'video/quicktime',
    'audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/webm',
    'image/png', 'image/jpeg', 'image/webp',
  ]),
  media: managedMediaMetadataSchema,
  objectRelativePath: z.string().regex(/^objects\/[a-f0-9]{64}\.bin$/),
  createdAt: z.string().datetime(),
}).strict();

export type VerifiedVideoMetadata = z.infer<typeof verifiedVideoMetadataSchema>;
export type VerifiedVideoMetadataInput = z.input<typeof verifiedVideoMetadataSchema>;
export type VerifiedAudioMetadata = z.infer<typeof verifiedAudioMetadataSchema>;
export type VerifiedImageMetadata = z.infer<typeof verifiedImageMetadataSchema>;
export type ManagedMediaMetadata = z.infer<typeof managedMediaMetadataSchema>;
export type ManagedMediaMetadataInput = z.input<typeof managedMediaMetadataSchema>;
export type GeneratedAsset = z.infer<typeof generatedAssetSchema>;
