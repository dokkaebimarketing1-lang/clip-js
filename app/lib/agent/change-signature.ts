import 'server-only';
import {createHmac, timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {agentCommandSchema, type AgentChangeSet} from './commands';
import {projectStateSchema} from '@/app/lib/workflow/project-file';
import {stableStringify} from '@/app/lib/workflow/hash';
import {getApprovalSecret} from '@/app/lib/security/approval-signature';

const hexDigest = z.string().regex(/^[0-9a-f]{64}$/i);

const signedChangeSetSchema = z.object({
  token: hexDigest,
  baseProjectHash: hexDigest,
  summary: z.string().min(1).max(1000),
  command: agentCommandSchema,
  proposedProject: projectStateSchema,
  serverSignature: hexDigest,
}).strict();

export type SignedAgentChangeSet = AgentChangeSet & {serverSignature: string};

const signedPayload = (changeSet: AgentChangeSet): string => stableStringify({
  token: changeSet.token,
  baseProjectHash: changeSet.baseProjectHash,
  summary: changeSet.summary,
  command: changeSet.command,
  proposedProject: changeSet.proposedProject,
});

export const signAgentChangeSet = (changeSet: AgentChangeSet): SignedAgentChangeSet => ({
  ...changeSet,
  serverSignature: createHmac('sha256', getApprovalSecret()).update(signedPayload(changeSet)).digest('hex'),
});

export const parseAndVerifyAgentChangeSet = (input: unknown): SignedAgentChangeSet => {
  const parsed = signedChangeSetSchema.parse(input) as unknown as SignedAgentChangeSet;
  const expected = createHmac('sha256', getApprovalSecret()).update(signedPayload(parsed)).digest('hex');
  const providedBuffer = Buffer.from(parsed.serverSignature);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
    throw new Error('Agent change set server signature is invalid.');
  }
  return parsed;
};
