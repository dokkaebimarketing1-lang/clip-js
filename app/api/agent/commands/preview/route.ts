import {NextRequest, NextResponse} from 'next/server';
import {agentCommandSchema, previewAgentCommand} from '@/app/lib/agent/commands';
import {parseProjectState} from '@/app/lib/workflow/project-file';
import {authorizeAgentRequest} from '@/app/lib/security/api-auth';
import {readLimitedJson} from '@/app/lib/security/request-body';
import {signAgentChangeSet} from '@/app/lib/agent/change-signature';

export async function POST(request: NextRequest) {
  try {
    authorizeAgentRequest(request);
    const body = await readLimitedJson(request) as {project?: unknown; command?: unknown};
    const project = parseProjectState(body.project);
    const command = agentCommandSchema.parse(body.command);
    return NextResponse.json(signAgentChangeSet(await previewAgentCommand(project, command)));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Preview failed.';
    return NextResponse.json({error: message}, {status: /Unauthorized|TOKEN/.test(message) ? 401 : 400});
  }
}
