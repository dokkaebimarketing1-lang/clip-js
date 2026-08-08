import {NextRequest, NextResponse} from 'next/server';
import {authorizeAgentRequest, authorizeApprovalRequest} from '@/app/lib/security/api-auth';
import {verifyStoryboardApprovalSignature} from '@/app/lib/security/approval-signature';
import {readLimitedJson} from '@/app/lib/security/request-body';
import {parseRenderProjectRequest} from '@/app/lib/workflow/project-file';
import {assertVideoGenerationAllowed} from '@/app/lib/workflow/approval';
import {compileHiggsfieldSeedanceRequest} from '@/app/lib/workflow/seedance-master';
import {submitHiggsfieldSeedanceJob} from '@/app/lib/higgsfield/generate.server';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    authorizeAgentRequest(request);
    authorizeApprovalRequest(request);
    const project = parseRenderProjectRequest(await readLimitedJson(request));
    verifyStoryboardApprovalSignature(project.id, project.workflow.approval);
    await assertVideoGenerationAllowed(project.workflow);
    if (!project.workflow.storyboard) throw new Error('Approved storyboard is required.');
    const higgsfieldRequest = compileHiggsfieldSeedanceRequest({
      storyboard: project.workflow.storyboard,
      production: project.workflow.production,
      settings: project.workflow.seedanceMaster,
    });
    const job = await submitHiggsfieldSeedanceJob(higgsfieldRequest);
    return NextResponse.json({job, request: higgsfieldRequest});
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown Higgsfield error.';
    console.error('Higgsfield submission failed:', error);
    if (/Unauthorized|CLIPJS_.*TOKEN/i.test(detail)) return NextResponse.json({error: 'Unauthorized.', code: 'UNAUTHORIZED'}, {status: 401});
    if (/approval|approved|server-signed/i.test(detail)) return NextResponse.json({error: detail, code: 'APPROVAL_REQUIRED'}, {status: 403});
    if (/must|required|invalid|unsupported|reference|mode|duration|resolution|aspect/i.test(detail)) return NextResponse.json({error: detail, code: 'INVALID_HIGGSFIELD_REQUEST'}, {status: 400});
    if (/timed out|timeout/i.test(detail)) return NextResponse.json({error: 'Higgsfield submission timed out.', code: 'HIGGSFIELD_TIMEOUT'}, {status: 504});
    return NextResponse.json({error: 'Higgsfield submission failed.', code: 'HIGGSFIELD_FAILED'}, {status: 500});
  }
}
