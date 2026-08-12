import {NextRequest, NextResponse} from 'next/server';
import {authorizeAgentRequest, authorizeApprovalRequest} from '@/app/lib/security/api-auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    authorizeAgentRequest(request);
    authorizeApprovalRequest(request);
    return NextResponse.json({
      error: 'Uncertain recovery requires an authoritative provider receipt lookup and is not enabled.',
      code: 'AUTHORITATIVE_RECOVERY_REQUIRED',
    }, {status: 409});
  } catch {
    return NextResponse.json({error: 'Unauthorized.', code: 'UNAUTHORIZED'}, {status: 401});
  }
}
