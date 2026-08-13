import {NextRequest, NextResponse} from 'next/server';
import {z} from 'zod';
import {authorizeAgentRequest, authorizeApprovalRequest} from '@/app/lib/security/api-auth';
import {readLimitedJson} from '@/app/lib/security/request-body';
import {getHiggsfieldAccountStatus, submitHiggsfieldSeedanceJob} from '@/app/lib/higgsfield/generate.server';
import {
  computeHiggsfieldIdempotencyKey,
  createHiggsfieldSubmissionGuard,
} from '@/app/lib/higgsfield/submission-guard.server';
import {higgsfieldSeedanceRequestSchema} from '@/app/lib/workflow/seedance-master';

export const runtime = 'nodejs';

const bodySchema = z.object({
  projectId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
  approvalSignature: z.string().min(1).max(512),
  request: higgsfieldSeedanceRequestSchema,
}).strict();

const guardedSubmit = createHiggsfieldSubmissionGuard({submit: submitHiggsfieldSeedanceJob});
const isTemporarySubmitEnabled = () => process.env.CLIPJS_HIGGSFIELD_TEMP_SUBMIT_ENABLED === 'true';

export async function GET(request: NextRequest) {
  try {
    authorizeAgentRequest(request);
    const account = await getHiggsfieldAccountStatus();
    return NextResponse.json({
      enabled: isTemporarySubmitEnabled(),
      credits: account.credits,
      plan: account.subscription_plan_type,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Higgsfield status failed.';
    const unauthorized = /Unauthorized|required/i.test(message);
    return NextResponse.json({
      error: unauthorized ? 'Unauthorized.' : 'Higgsfield CLI is unavailable.',
      code: unauthorized ? 'UNAUTHORIZED' : 'HIGGSFIELD_UNAVAILABLE',
    }, {status: unauthorized ? 401 : 503});
  }
}

/**
 * Temporary, explicitly gated Higgsfield CLI bridge for integration testing.
 * BytePlus remains the production provider. This endpoint stays fail-closed
 * unless CLIPJS_HIGGSFIELD_TEMP_SUBMIT_ENABLED is exactly "true".
 */
export async function POST(request: NextRequest) {
  try {
    authorizeAgentRequest(request);
    authorizeApprovalRequest(request);
    if (!isTemporarySubmitEnabled()) {
      return NextResponse.json({
        error: 'Temporary Higgsfield submission is disabled.',
        code: 'TEMP_PROVIDER_DISABLED',
      }, {status: 410});
    }

    const body = bodySchema.parse(await readLimitedJson(request));
    const key = computeHiggsfieldIdempotencyKey(body.projectId, body.approvalSignature, body.request);
    const result = await guardedSubmit(key, body.request);
    return NextResponse.json(result, {status: 202});
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Higgsfield submission failed.';
    const unauthorized = /Unauthorized|required/i.test(message);
    const uncertain = /uncertain|queue is full/i.test(message);
    const status = unauthorized ? 401 : uncertain ? 409 : 400;
    const code = unauthorized ? 'UNAUTHORIZED' : uncertain ? 'SUBMISSION_BLOCKED' : 'INVALID_HIGGSFIELD_REQUEST';
    console.error('Temporary Higgsfield submission rejected.', {
      code,
      name: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json({error: 'Higgsfield submission was not accepted.', code}, {status});
  }
}
