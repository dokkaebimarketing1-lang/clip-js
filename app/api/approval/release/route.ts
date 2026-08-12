import {NextRequest, NextResponse} from 'next/server';
import {authorizeApprovalRequest} from '@/app/lib/security/api-auth';
import {signReleaseApproval} from '@/app/lib/security/approval-signature';
import {readLimitedJson} from '@/app/lib/security/request-body';
import {computeRenderInputHash} from '@/app/lib/workflow/approval-v3';
import {parseRenderProjectRequest} from '@/app/lib/workflow/project-file';
import {assertReleasePreflight} from '@/app/lib/workflow/release-preflight.server';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    authorizeApprovalRequest(request);
    const project = parseRenderProjectRequest(await readLimitedJson(request));
    assertReleasePreflight(project);
    const releaseApproval = signReleaseApproval(project.id, {
      status: 'approved',
      renderInputHash: await computeRenderInputHash(project),
      approvedAt: new Date().toISOString(),
      approvedBy: 'project-owner',
    });
    return NextResponse.json(releaseApproval);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Release approval failed.';
    const status = /Unauthorized|required in production/i.test(message) ? 401 : 400;
    return NextResponse.json({error: message}, {status});
  }
}
