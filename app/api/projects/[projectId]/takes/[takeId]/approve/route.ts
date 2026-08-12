import {NextRequest, NextResponse} from 'next/server';
import {z} from 'zod';
import {authorizeAgentRequest, authorizeApprovalRequest} from '@/app/lib/security/api-auth';
import {readLimitedJson} from '@/app/lib/security/request-body';
import {getGenerationRepository} from '@/app/lib/generation/runtime.server';
import {signTakeApproval} from '@/app/lib/security/approval-signature';
import {takeApprovalSchema} from '@/app/lib/workflow/production-schema';

const approveSchema = z.object({
  requestKey: z.string().regex(/^[a-f0-9]{64}$/),
  assetId: z.string().min(1).max(256),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export async function POST(request: NextRequest, context: {params: Promise<{projectId: string; takeId: string}>}) {
  try {
    authorizeAgentRequest(request);
    authorizeApprovalRequest(request);
    const {projectId, takeId} = await context.params;
    const body = approveSchema.parse(await readLimitedJson(request));
    const record = await getGenerationRepository().get(body.requestKey);
    if (!record || record.claim.projectId !== projectId || record.job.status !== 'ready') {
      return NextResponse.json({error: 'Ready generation Take not found.'}, {status: 404});
    }
    if (record.job.takeId !== takeId || record.job.assetId !== body.assetId || record.job.contentSha256 !== body.contentSha256) {
      throw new Error('Take approval identity does not match the ready generation record.');
    }
    const unsigned = takeApprovalSchema.parse({
      status: 'approved',
      takeId,
      assetId: body.assetId,
      contentSha256: body.contentSha256,
      approvedAt: new Date().toISOString(),
      approvedBy: 'project-owner',
    });
    return NextResponse.json({takeApproval: signTakeApproval(projectId, unsigned)});
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Take approval failed.';
    return NextResponse.json({error: message}, {status: /Unauthorized|required/i.test(message) ? 401 : 400});
  }
}
