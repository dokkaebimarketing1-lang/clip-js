import {z} from 'zod';
import {
  characterSheetSchema,
  interviewBriefSchema,
  storyboardSchema,
  styleBibleSchema,
} from '@/app/lib/workflow/schema';

export const storyboardJobInputSchema = z.object({
  projectId: z.string().min(1).max(128),
  sentence: z.string().trim().min(1).max(2000),
  interviewBrief: interviewBriefSchema,
  styleBible: styleBibleSchema,
  styleBibleHash: z.string().regex(/^[a-f0-9]{64}$/),
  characterSheets: z.array(characterSheetSchema.extend({
    id: z.string().regex(/^CHAR\d{2}$/),
    referenceImageId: z.string().regex(/^ga_[a-f0-9]{32}$/),
    referenceStyleHash: z.string().regex(/^[a-f0-9]{64}$/),
  })).min(1).max(10),
}).strict();

export const storyboardJobLeaseSchema = z.object({
  token: z.string().uuid(),
  workerId: z.string().min(1).max(128),
  claimedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export const storyboardJobRecordSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  jobId: z.string().regex(/^sj_[a-f0-9]{64}$/),
  projectId: z.string().min(1).max(128),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['queued', 'processing', 'completed', 'failed']),
  input: storyboardJobInputSchema,
  attempt: z.number().int().nonnegative(),
  lease: storyboardJobLeaseSchema.optional(),
  storyboard: storyboardSchema.optional(),
  error: z.string().min(1).max(1000).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).superRefine((record, context) => {
  if (record.projectId !== record.input.projectId) {
    context.addIssue({code: z.ZodIssueCode.custom, message: 'Project identity mismatch.'});
  }
  if (record.status === 'processing' && !record.lease) {
    context.addIssue({code: z.ZodIssueCode.custom, message: 'Processing job requires a lease.'});
  }
  if (record.status === 'completed' && !record.storyboard) {
    context.addIssue({code: z.ZodIssueCode.custom, message: 'Completed job requires a storyboard.'});
  }
  if (record.status === 'failed' && !record.error) {
    context.addIssue({code: z.ZodIssueCode.custom, message: 'Failed job requires an error.'});
  }
});

export type StoryboardJobInput = z.infer<typeof storyboardJobInputSchema>;
export type StoryboardJobRecord = z.infer<typeof storyboardJobRecordSchema>;
