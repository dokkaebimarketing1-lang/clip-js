import {z} from 'zod';
import projectReducer, {installStoryboardIfCurrent} from '@/app/store/slices/projectSlice';
import type {ProjectState} from '@/app/types';
import {prepareStoryboardInstallCommand} from '@/app/lib/workflow/storyboard-apply';
import {storyboardJobInputSchema} from './storyboard-job-schema';
import {storyboardSchema} from '@/app/lib/workflow/schema';

export const storyboardJobResponseSchema = z.object({
  stage: z.literal('storyboard-job'),
  jobId: z.string().regex(/^sj_[a-f0-9]{64}$/),
  projectId: z.string().min(1).max(128),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['queued', 'processing', 'completed', 'failed']),
  input: storyboardJobInputSchema,
  attempt: z.number().int().nonnegative(),
  storyboard: storyboardSchema.optional(),
  error: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).passthrough();

export type StoryboardJobResponse = z.infer<typeof storyboardJobResponseSchema>;

export class StaleStoryboardJobError extends Error {
  constructor() {
    super('생성 중 기획 또는 기준 시트가 변경되어 이전 요청의 콘티를 적용하지 않았습니다. 현재 내용을 확인한 뒤 다시 생성하세요.');
    this.name = 'StaleStoryboardJobError';
  }
}

export const prepareCompletedStoryboardJobCommand = (rawJob: unknown) => {
  const job = storyboardJobResponseSchema.parse(rawJob);
  if (job.status !== 'completed' || !job.storyboard) throw new StaleStoryboardJobError();
  return prepareStoryboardInstallCommand({...job.input, storyboard: job.storyboard});
};

export const applyCompletedStoryboardJob = (current: ProjectState, rawJob: unknown): ProjectState => {
  const job = storyboardJobResponseSchema.parse(rawJob);
  if (job.status !== 'completed' || !job.storyboard || job.projectId !== current.id) {
    throw new StaleStoryboardJobError();
  }
  const command = prepareCompletedStoryboardJobCommand(job);
  const next = projectReducer(current, installStoryboardIfCurrent(command));
  if (JSON.stringify(next.workflow.storyboard ?? null) !== JSON.stringify(job.storyboard)) {
    throw new StaleStoryboardJobError();
  }
  return next;
};
