import 'server-only';
import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import {stableStringify} from '@/app/lib/workflow/hash';
import {generationApprovalSchema} from '@/app/lib/workflow/schema';
import {takeApprovalSchema, type TakeApproval} from '@/app/lib/workflow/production-schema';
import type {
  CreativeApproval,
  GenerationApproval,
  LegacyStoryboardApproval,
  ReleaseApproval,
} from '@/app/lib/workflow/schema';

const developmentSecret = randomBytes(32).toString('hex');

export const getApprovalSecret = (): string => {
  const secret = process.env.CLIPJS_APPROVAL_SIGNING_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('CLIPJS_APPROVAL_SIGNING_SECRET is required in production.');
    return developmentSecret;
  }
  return secret;
};

type SignableApproval = CreativeApproval | GenerationApproval | TakeApproval | ReleaseApproval | LegacyStoryboardApproval;
type ApprovalKind = 'creative' | 'generation' | 'take' | 'release' | 'legacy-storyboard';

const unsignedApproval = (approval: SignableApproval): Record<string, unknown> => {
  const unsigned = {...approval} as Record<string, unknown>;
  delete unsigned.signature;
  return unsigned;
};

const approvalPayload = (kind: ApprovalKind, projectId: string, approval: SignableApproval): string =>
  stableStringify({kind, projectId, approval: unsignedApproval(approval)});

const signingKeyId = (): string => process.env.CLIPJS_APPROVAL_SIGNING_KEY_ID || 'primary';

const sign = <T extends SignableApproval>(kind: ApprovalKind, projectId: string, approval: T): T => {
  const prepared = {...approval, signatureVersion: 1 as const, signingKeyId: signingKeyId()};
  return {
    ...prepared,
    signature: createHmac('sha256', getApprovalSecret()).update(approvalPayload(kind, projectId, prepared)).digest('hex'),
  } as T;
};

const verify = (kind: ApprovalKind, projectId: string, approval: SignableApproval): void => {
  if (approval.status !== 'approved' || !approval.signature) throw new Error(`${kind} approval is not server-signed.`);
  if (approval.signatureVersion !== 1 || approval.signingKeyId !== signingKeyId()) throw new Error(`${kind} approval signature version or key ID is invalid.`);
  const expected = createHmac('sha256', getApprovalSecret()).update(approvalPayload(kind, projectId, approval)).digest('hex');
  const provided = Buffer.from(approval.signature);
  const target = Buffer.from(expected);
  if (provided.length !== target.length || !timingSafeEqual(provided, target)) throw new Error(`${kind} approval signature is invalid.`);
};

export const signCreativeApproval = (projectId: string, approval: CreativeApproval): CreativeApproval =>
  sign('creative', projectId, approval);

export const verifyCreativeApprovalSignature = (projectId: string, approval: CreativeApproval): void =>
  verify('creative', projectId, approval);

export const signGenerationApproval = (projectId: string, approval: GenerationApproval): GenerationApproval => {
  const parsed = generationApprovalSchema.parse(approval);
  if (parsed.projectId !== projectId) throw new Error('Generation authorization project scope does not match.');
  return sign('generation', projectId, parsed);
};

export const verifyGenerationApprovalSignature = (projectId: string, approval: GenerationApproval): void => {
  const parsed = generationApprovalSchema.parse(approval);
  if (parsed.projectId !== projectId) throw new Error('Generation authorization project scope does not match.');
  verify('generation', projectId, parsed);
};

export const signTakeApproval = (projectId: string, approval: TakeApproval): TakeApproval =>
  sign('take', projectId, takeApprovalSchema.parse(approval));

export const verifyTakeApprovalSignature = (projectId: string, approval: TakeApproval): void =>
  verify('take', projectId, takeApprovalSchema.parse(approval));

export const signReleaseApproval = (projectId: string, approval: ReleaseApproval): ReleaseApproval =>
  sign('release', projectId, approval);

export const verifyReleaseApprovalSignature = (projectId: string, approval: ReleaseApproval): void =>
  verify('release', projectId, approval);

/** Legacy v2 import verification only. */
export const signStoryboardApproval = (projectId: string, approval: LegacyStoryboardApproval): LegacyStoryboardApproval =>
  sign('legacy-storyboard', projectId, approval);

/** Legacy v2 import verification only. */
export const verifyStoryboardApprovalSignature = (projectId: string, approval: LegacyStoryboardApproval): void =>
  verify('legacy-storyboard', projectId, approval);
