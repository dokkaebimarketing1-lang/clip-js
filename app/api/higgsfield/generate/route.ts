import {NextRequest, NextResponse} from 'next/server';
import {authorizeAgentRequest, authorizeApprovalRequest} from '@/app/lib/security/api-auth';
import {parseRenderProjectRequest} from '@/app/lib/workflow/project-file';
import {verifyStoryboardApprovalSignature} from '@/app/lib/security/approval-signature';
import {assertVideoGenerationAllowed} from '@/app/lib/workflow/approval';
import {compileHiggsfieldSeedanceRequest} from '@/app/lib/workflow/seedance-master';
import {HiggsfieldSubmissionTimeoutError, submitHiggsfieldSeedanceJob} from '@/app/lib/higgsfield/generate.server';
import {computeHiggsfieldIdempotencyKey, createHiggsfieldSubmissionGuard} from '@/app/lib/higgsfield/submission-guard.server';
import {SerialTaskQueueFullError} from '@/app/lib/render/serial-task-queue';
import {readLimitedJson} from '@/app/lib/security/request-body';

export const runtime = 'nodejs';
export const maxDuration = 120;
const submitOnce = createHiggsfieldSubmissionGuard({submit: submitHiggsfieldSeedanceJob, maxPending: 1});

export async function POST(request: NextRequest) {
  try {
    authorizeAgentRequest(request);
    authorizeApprovalRequest(request);
  } catch {
    return NextResponse.json({error: 'Unauthorized.', code: 'UNAUTHORIZED'}, {status: 401});
  }

  let project;
  try {
    project = parseRenderProjectRequest(await readLimitedJson(request));
  } catch {
    return NextResponse.json({error: 'Invalid project request.', code: 'INVALID_REQUEST'}, {status: 400});
  }

  try {
    verifyStoryboardApprovalSignature(project.id, project.workflow.approval);
    await assertVideoGenerationAllowed(project.workflow);
  } catch {
    return NextResponse.json({error: 'The exact current project is not approved.', code: 'APPROVAL_REQUIRED'}, {status: 403});
  }

  let higgsfieldRequest;
  try {
    if (!project.workflow.storyboard) throw new Error('Storyboard required.');
    higgsfieldRequest = compileHiggsfieldSeedanceRequest({
      storyboard: project.workflow.storyboard,
      production: project.workflow.production,
      settings: project.workflow.seedanceMaster,
    });
  } catch {
    return NextResponse.json({error: 'Invalid Higgsfield request.', code: 'INVALID_HIGGSFIELD_REQUEST'}, {status: 400});
  }

  const signature = project.workflow.approval.signature;
  if (!signature) return NextResponse.json({error: 'The exact current project is not approved.', code: 'APPROVAL_REQUIRED'}, {status: 403});
  const idempotencyKey = computeHiggsfieldIdempotencyKey(project.id, signature, higgsfieldRequest);

  try {
    const {job, reused} = await submitOnce(idempotencyKey, higgsfieldRequest);
    return NextResponse.json({job, request: higgsfieldRequest, idempotencyKey, reused});
  } catch (error) {
    console.error('Higgsfield submission failed.', {name: error instanceof Error ? error.name : 'UnknownError'});
    if (error instanceof SerialTaskQueueFullError) {
      return NextResponse.json({error: 'Another Higgsfield submission is in progress.', code: 'HIGGSFIELD_BUSY'}, {status: 503});
    }
    if (error instanceof HiggsfieldSubmissionTimeoutError) {
      return NextResponse.json({error: 'Higgsfield submission timed out.', code: 'HIGGSFIELD_TIMEOUT'}, {status: 504});
    }
    return NextResponse.json({error: 'Higgsfield submission failed.', code: 'HIGGSFIELD_FAILED'}, {status: 500});
  }
}
