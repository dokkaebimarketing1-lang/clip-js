import {NextRequest, NextResponse} from 'next/server';
import {z} from 'zod';
import {approveStoryboard} from '@/app/lib/workflow/approval';
import {storyboardSchema} from '@/app/lib/workflow/schema';
import {authorizeApprovalRequest} from '@/app/lib/security/api-auth';
import {signStoryboardApproval} from '@/app/lib/security/approval-signature';
import {readLimitedJson} from '@/app/lib/security/request-body';

const requestSchema = z.object({projectId: z.string().min(1).max(128), storyboard: storyboardSchema}).strict();

export async function POST(request: NextRequest) {
  try {
    authorizeApprovalRequest(request);
    const {projectId, storyboard} = requestSchema.parse(await readLimitedJson(request));
    const approval = await approveStoryboard(storyboard, 'project-owner');
    return NextResponse.json(signStoryboardApproval(projectId, approval));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Approval failed.';
    const status = /Unauthorized|required in production/i.test(message) ? 401 : 400;
    return NextResponse.json({error: message}, {status});
  }
}
