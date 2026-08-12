import {NextRequest, NextResponse} from 'next/server';
import {z} from 'zod';
import {authorizeAgentRequest, authorizeApprovalRequest} from '@/app/lib/security/api-auth';
import {readLimitedJson} from '@/app/lib/security/request-body';
import {parseProjectState} from '@/app/lib/workflow/project-file';
import {
  getConfiguredGenerationProvider,
  getGenerationRepository,
  isGenerationSubmitEnabled,
} from '@/app/lib/generation/runtime.server';
import {submitAuthorizedGeneration} from '@/app/lib/generation/submit-generation.server';
import {projectGenerationProjection} from '@/app/lib/generation/generation-projection';

const submitSchema = z.object({project: z.unknown()}).strict();

export async function POST(request: NextRequest, context: {params: Promise<{projectId: string}>}) {
  try {
    authorizeAgentRequest(request);
    authorizeApprovalRequest(request);
    const {projectId} = await context.params;
    const body = submitSchema.parse(await readLimitedJson(request));
    const project = parseProjectState(body.project);
    if (project.id !== projectId) throw new Error('Project scope does not match request body.');
    const submitted = await submitAuthorizedGeneration({
      project,
      repository: getGenerationRepository(),
      provider: getConfiguredGenerationProvider(),
      allowProviderSubmit: isGenerationSubmitEnabled(),
    });
    return NextResponse.json({reused: submitted.reused, generation: projectGenerationProjection(submitted.record)}, {status: 202});
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Generation submission failed.';
    const status = /Unauthorized|required/i.test(message) ? 401
      : /disabled|No generation provider/i.test(message) ? 503
        : /unresolved|attempt ID|billing scope/i.test(message) ? 409 : 400;
    const code = status === 401 ? 'UNAUTHORIZED' : status === 503 ? 'PROVIDER_DISABLED' : status === 409 ? 'SUBMISSION_BLOCKED' : 'INVALID_GENERATION_REQUEST';
    console.error('Generation submission rejected.', {code, name: error instanceof Error ? error.name : 'UnknownError'});
    return NextResponse.json({error: 'Generation submission was not accepted.', code}, {status});
  }
}

export async function GET(request: NextRequest, context: {params: Promise<{projectId: string}>}) {
  try {
    authorizeAgentRequest(request);
    const {projectId} = await context.params;
    const records = await getGenerationRepository().listProject(projectId);
    return NextResponse.json({generations: records.map(projectGenerationProjection)});
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Generation listing failed.';
    const status = /Unauthorized|required/i.test(message) ? 401 : 400;
    return NextResponse.json({error: status === 401 ? 'Unauthorized.' : 'Invalid generation listing request.'}, {status});
  }
}
