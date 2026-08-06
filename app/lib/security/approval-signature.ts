import 'server-only';
import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import type {StoryboardApproval} from '@/app/lib/workflow/schema';

const developmentSecret = randomBytes(32).toString('hex');

export const getApprovalSecret = (): string => {
  const secret = process.env.CLIPJS_APPROVAL_TOKEN;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('CLIPJS_APPROVAL_TOKEN is required in production.');
    return developmentSecret;
  }
  return secret;
};

const payload = (projectId: string, approval: StoryboardApproval): string => JSON.stringify({
  projectId,
  status: approval.status,
  storyboardHash: approval.storyboardHash,
  approvedAt: approval.approvedAt,
  approvedBy: approval.approvedBy,
});

export const signStoryboardApproval = (projectId: string, approval: StoryboardApproval): StoryboardApproval => ({
  ...approval,
  signature: createHmac('sha256', getApprovalSecret()).update(payload(projectId, approval)).digest('hex'),
});

export const verifyStoryboardApprovalSignature = (projectId: string, approval: StoryboardApproval): void => {
  if (approval.status !== 'approved' || !approval.signature) throw new Error('Storyboard approval is not server-signed.');
  const expected = createHmac('sha256', getApprovalSecret()).update(payload(projectId, approval)).digest('hex');
  const provided = Buffer.from(approval.signature);
  const target = Buffer.from(expected);
  if (provided.length !== target.length || !timingSafeEqual(provided, target)) throw new Error('Storyboard approval signature is invalid.');
};
