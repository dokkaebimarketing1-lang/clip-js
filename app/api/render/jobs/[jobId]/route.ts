import {NextRequest, NextResponse} from 'next/server';
import {existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {authorizeAgentRequest, createRenderDownloadToken} from '@/app/lib/security/api-auth';
import {getRenderJobRepository} from '@/app/lib/render-jobs/runtime.server';

export async function GET(request: NextRequest, context: {params: Promise<{jobId: string}>}) {
  try {
    authorizeAgentRequest(request);
    const {jobId} = await context.params;
    const job = await getRenderJobRepository().get(jobId);
    if (!job) return NextResponse.json({error: 'Render job not found.'}, {status: 404});
    const response: Record<string, unknown> = {
      jobId: job.id,
      projectId: job.projectId,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      error: job.status === 'failed' ? 'Render worker failed. Review server logs before an explicit retry.' : undefined,
    };
    if (job.status === 'succeeded') {
      const artifactPath = join(resolve(/*turbopackIgnore: true*/ process.env.CLIPJS_RENDER_OUTPUT_DIR || 'renders'), `${job.outputRenderId}.mp4`);
      if (!existsSync(artifactPath)) {
        response.status = 'expired';
        response.code = 'RENDER_ARTIFACT_EXPIRED';
        response.retryRequired = true;
      } else {
        const token = createRenderDownloadToken(job.outputRenderId);
        response.downloadUrl = `/api/render/file/${job.outputRenderId}?token=${encodeURIComponent(token)}`;
      }
    }
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const status = /Unauthorized|required/i.test(message) ? 401 : 400;
    return NextResponse.json({error: status === 401 ? 'Unauthorized.' : 'Invalid render status request.'}, {status});
  }
}
