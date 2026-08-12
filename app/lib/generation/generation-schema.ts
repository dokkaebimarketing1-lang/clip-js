import {z} from 'zod';

const hex64 = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime();

export const generationProviderSchema = z.enum(['byteplus', 'fake', 'higgsfield']);
export const generationLeaseSchema = z.object({
  workerId: z.string().min(1).max(128),
  fencingToken: z.number().int().positive(),
  acquiredAt: timestamp,
  expiresAt: timestamp,
}).strict();

const jobBase = z.object({
  version: z.literal(1),
  projectId: z.string().min(1).max(256),
  attemptId: z.string().min(1).max(128),
  requestKey: hex64,
  requestHash: hex64,
  provider: generationProviderSchema,
  model: z.string().min(1).max(200),
  authorizedDuration: z.union([z.literal(20), z.literal(30)]).default(30),
  authorizedResolution: z.enum(['480p', '720p']).default('720p'),
  authorizedGenerateAudio: z.boolean().default(false),
  takeScope: z.enum(['production', 'shot']).default('production'),
  targetShotSpecId: z.string().min(1).max(128).optional(),
  authorizationRef: z.string().min(1).max(256),
  createdAt: timestamp,
  updatedAt: timestamp,
  nextPollAt: timestamp.optional(),
  lease: generationLeaseSchema.optional(),
  lastError: z.string().max(4_000).optional(),
  lastErrorStage: z.enum(['claim', 'submit', 'receipt', 'poll', 'ingest', 'qc']).optional(),
});

const withProviderJob = jobBase.extend({providerJobId: z.string().min(1).max(512)});

export const generationJobSchema = z.discriminatedUnion('status', [
  jobBase.extend({status: z.literal('submitting'), providerJobId: z.never().optional()}),
  withProviderJob.extend({status: z.literal('queued')}),
  withProviderJob.extend({status: z.literal('running')}),
  withProviderJob.extend({status: z.literal('provider_succeeded'), resultTransportCiphertext: z.string().regex(/^v1\./).max(8192).optional()}),
  withProviderJob.extend({status: z.literal('ingesting'), resultTransportCiphertext: z.string().regex(/^v1\./).max(8192).optional()}),
  withProviderJob.extend({status: z.literal('ready'), assetId: z.string().min(1).max(256), contentSha256: hex64, actualDurationSeconds: z.number().positive().max(32), takeId: z.string().min(1).max(256), qcStatus: z.literal('qc_pending')}),
  jobBase.extend({status: z.literal('failed'), providerJobId: z.string().min(1).max(512).optional()}),
  jobBase.extend({status: z.literal('cancelled'), providerJobId: z.string().min(1).max(512).optional()}),
  jobBase.extend({status: z.literal('expired'), providerJobId: z.string().min(1).max(512).optional()}),
  jobBase.extend({status: z.literal('uncertain'), providerJobId: z.string().min(1).max(512).optional()}),
  withProviderJob.extend({status: z.literal('ingest_failed'), resultTransportCiphertext: z.string().regex(/^v1\./).max(8192).optional()}),
]);

export const submissionClaimSchema = z.object({
  version: z.literal(1),
  status: z.enum(['claimed', 'submitted', 'uncertain']),
  projectId: z.string().min(1).max(256),
  attemptId: z.string().min(1).max(128),
  requestKey: hex64,
  requestHash: hex64,
  createdAt: timestamp,
  updatedAt: timestamp,
  providerJobId: z.string().min(1).max(512).optional(),
}).strict();

export const generationRecordSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  requestKey: hex64,
  claim: submissionClaimSchema,
  job: generationJobSchema,
}).strict().superRefine((record, ctx) => {
  for (const [field, value] of [
    ['projectId', record.job.projectId],
    ['attemptId', record.job.attemptId],
    ['requestKey', record.job.requestKey],
    ['requestHash', record.job.requestHash],
  ] as const) {
    if (record.claim[field] !== value) ctx.addIssue({code: z.ZodIssueCode.custom, path: ['claim', field], message: `Claim/job ${field} mismatch.`});
  }
  if (record.requestKey !== record.claim.requestKey) ctx.addIssue({code: z.ZodIssueCode.custom, path: ['requestKey'], message: 'Record request key mismatch.'});
});

export type GenerationProvider = z.infer<typeof generationProviderSchema>;
export type GenerationLease = z.infer<typeof generationLeaseSchema>;
export type GenerationJob = z.infer<typeof generationJobSchema>;
export type SubmissionClaim = z.infer<typeof submissionClaimSchema>;
export type GenerationRecord = z.infer<typeof generationRecordSchema>;
