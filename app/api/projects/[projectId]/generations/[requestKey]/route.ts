import {NextRequest, NextResponse} from 'next/server';
import {authorizeAgentRequest} from '@/app/lib/security/api-auth';
import {getGenerationRepository} from '@/app/lib/generation/runtime.server';
import {projectGenerationProjection} from '@/app/lib/generation/generation-projection';

const requestKeyPattern = /^[a-f0-9]{64}$/;

export async function GET(request: NextRequest, context: {params: Promise<{projectId: string; requestKey: string}>}) {
  try {
    authorizeAgentRequest(request);
    const {projectId, requestKey} = await context.params;
    if (!requestKeyPattern.test(requestKey)) throw new Error('Invalid generation request key.');
    const record = await getGenerationRepository().get(requestKey);
    if (!record || record.claim.projectId !== projectId) {
      return NextResponse.json({error: 'Generation not found.'}, {status: 404});
    }
    return NextResponse.json({generation: projectGenerationProjection(record)});
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Generation lookup failed.';
    return NextResponse.json({error: message}, {status: /Unauthorized|required/i.test(message) ? 401 : 400});
  }
}
