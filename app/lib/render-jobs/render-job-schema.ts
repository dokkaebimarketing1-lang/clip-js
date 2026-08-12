import {z} from 'zod';

const timestamp = z.string().datetime();
const hex64 = z.string().regex(/^[a-f0-9]{64}$/);
export const renderJobIdSchema = z.string().regex(/^rj_[a-f0-9]{32}$/);
export const renderLeaseSchema = z.object({workerId: z.string().min(1).max(128), fencingToken: z.number().int().positive(), acquiredAt: timestamp, expiresAt: timestamp}).strict();

const base = z.object({
  version: z.literal(1), id: renderJobIdSchema, projectId: z.string().min(1).max(256),
  renderInputHash: hex64, releaseSignature: hex64, projectSnapshot: z.unknown(),
  attemptCount: z.number().int().nonnegative().default(0),
  createdAt: timestamp, updatedAt: timestamp, nextAttemptAt: timestamp.optional(),
  lease: renderLeaseSchema.optional(), error: z.string().max(4000).optional(),
});

export const renderJobSchema = z.discriminatedUnion('status', [
  base.extend({status: z.literal('queued')}),
  base.extend({status: z.literal('running')}),
  base.extend({status: z.literal('succeeded'), outputRenderId: z.string().uuid()}),
  base.extend({status: z.literal('failed')}),
  base.extend({status: z.literal('cancelled')}),
]);

export type RenderLease = z.infer<typeof renderLeaseSchema>;
export type RenderJob = z.infer<typeof renderJobSchema>;
