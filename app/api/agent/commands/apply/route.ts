import {NextRequest, NextResponse} from 'next/server';
import {approveAgentChange} from '@/app/lib/agent/commands';
import {parseProjectState} from '@/app/lib/workflow/project-file';
import {authorizeApprovalRequest} from '@/app/lib/security/api-auth';
import {readLimitedJson} from '@/app/lib/security/request-body';
import {parseAndVerifyAgentChangeSet} from '@/app/lib/agent/change-signature';

export async function POST(request: NextRequest) {
  try {
    authorizeApprovalRequest(request);
    const body = await readLimitedJson(request) as {project?: unknown; changeSet?: unknown; approvalToken?: unknown};
    const project = parseProjectState(body.project);
    const changeSet = parseAndVerifyAgentChangeSet(body.changeSet);
    const approved = await approveAgentChange(project, changeSet, String(body.approvalToken ?? ''));
    return NextResponse.json(parseProjectState(approved));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Apply failed.';
    return NextResponse.json({error: message}, {status: /Unauthorized|TOKEN/.test(message) ? 401 : 400});
  }
}
