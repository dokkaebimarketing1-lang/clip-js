import {NextRequest, NextResponse} from 'next/server';
import {authorizeAgentRequest, authorizeApprovalRequest} from '@/app/lib/security/api-auth';

export const runtime = 'nodejs';

/**
 * Legacy Higgsfield generation is intentionally disabled. Existing Higgsfield
 * metadata remains readable only for migration; new paid work must use the
 * project-scoped BytePlus GenerationAuthorization flow.
 */
export async function POST(request: NextRequest) {
  try {
    authorizeAgentRequest(request);
    authorizeApprovalRequest(request);
  } catch {
    return NextResponse.json({error: 'Unauthorized.', code: 'UNAUTHORIZED'}, {status: 401});
  }
  return NextResponse.json({
    error: 'Legacy Higgsfield submission is disabled. Use the BytePlus project generation endpoint.',
    code: 'LEGACY_PROVIDER_DISABLED',
  }, {status: 410});
}
