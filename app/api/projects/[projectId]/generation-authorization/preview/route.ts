import {NextRequest, NextResponse} from 'next/server';
import {z} from 'zod';
import {authorizeApprovalRequest} from '@/app/lib/security/api-auth';
import {readLimitedJson} from '@/app/lib/security/request-body';
import {parseProjectState} from '@/app/lib/workflow/project-file';
import {createGenerationAuthorizationPreview} from '@/app/lib/byteplus/generation-authorization.server';

const requestSchema = z.object({
  attemptId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  project: z.unknown(),
}).strict();

export async function POST(request: NextRequest, context: {params: Promise<{projectId: string}>}) {
  try {
    authorizeApprovalRequest(request);
    const {projectId} = await context.params;
    const body = requestSchema.parse(await readLimitedJson(request));
    const project = parseProjectState(body.project);
    if (project.id !== projectId) throw new Error('Project scope does not match request body.');
    return NextResponse.json(await createGenerationAuthorizationPreview(project, body.attemptId));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Generation authorization preview failed.';
    const status = /Unauthorized|required in production/i.test(message) ? 401 : 400;
    return NextResponse.json({error: message}, {status});
  }
}
