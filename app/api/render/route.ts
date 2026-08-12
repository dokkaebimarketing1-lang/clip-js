import {NextRequest, NextResponse} from 'next/server';
import {existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {assertRenderReleaseApproved} from '@/app/lib/workflow/approval-v3';
import {parseRenderProjectRequest, serializeProject} from '@/app/lib/workflow/project-file';
import {assertSafeRemoteUrlResolved} from '@/app/lib/security/remote-url.server';
import {authorizeAgentRequest, authorizeApprovalRequest} from '@/app/lib/security/api-auth';
import {assertRenderLimits} from '@/app/lib/render/limits';
import {verifyReleaseApprovalSignature} from '@/app/lib/security/approval-signature';
import {readLimitedJson} from '@/app/lib/security/request-body';
import {assertReleasePreflight} from '@/app/lib/workflow/release-preflight.server';
import {getRenderJobRepository} from '@/app/lib/render-jobs/runtime.server';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    authorizeAgentRequest(request);
    authorizeApprovalRequest(request);
    const project = parseRenderProjectRequest(await readLimitedJson(request));
    verifyReleaseApprovalSignature(project.id, project.workflow.releaseApproval);
    await assertRenderReleaseApproved(project);
    assertReleasePreflight(project);
    assertRenderLimits(project);
    for (const media of project.mediaFiles) {
      if (media.source?.kind === 'generated' || media.source?.kind === 'managed') continue;
      if (!media.remoteUrl) throw new Error(`Media ${media.id} has no renderable remote URL.`);
      await assertSafeRemoteUrlResolved(media.remoteUrl);
    }
    const renderInputHash = project.workflow.releaseApproval.renderInputHash;
    const releaseSignature = project.workflow.releaseApproval.signature;
    if (!renderInputHash || !releaseSignature) throw new Error('Signed release approval is incomplete.');
    const repository = getRenderJobRepository();
    const snapshot = serializeProject(project).project;
    const created = await repository.create({
      projectId: project.id,
      renderInputHash,
      releaseSignature,
      projectSnapshot: snapshot,
    });
    let record = created.record;
    if (!created.created && (record.status === 'failed' || record.status === 'succeeded')) {
      const artifactExists = record.status === 'succeeded'
        && existsSync(join(resolve(/*turbopackIgnore: true*/ process.env.CLIPJS_RENDER_OUTPUT_DIR || 'renders'), `${record.outputRenderId}.mp4`));
      const retryNeeded = record.status === 'failed' || !artifactExists;
      if (retryNeeded) {
        if (request.headers.get('x-clipjs-render-retry') !== 'true') {
          return NextResponse.json({error: 'Explicit render retry is required.', code: 'RENDER_RETRY_REQUIRED'}, {status: 409});
        }
        if (record.attemptCount >= 3) {
          return NextResponse.json({error: 'Render retry limit reached.', code: 'RENDER_RETRY_LIMIT'}, {status: 409});
        }
        record = await repository.requeueTerminal(record.id, {releaseSignature, projectSnapshot: snapshot});
      }
    }
    return NextResponse.json({
      jobId: record.id,
      status: record.status,
      statusUrl: `/api/render/jobs/${record.id}`,
      reused: !created.created,
    }, {status: 202});
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown render error.';
    console.error('Render request failed:', error);
    if (/Unauthorized|CLIPJS_.*TOKEN/i.test(detail)) {
      return NextResponse.json({error: 'Unauthorized.', code: 'UNAUTHORIZED'}, {status: 401});
    }
    if (/approval|approved|server-signed|preflight/i.test(detail)) {
      return NextResponse.json({error: detail, code: 'APPROVAL_REQUIRED'}, {status: 403});
    }
    const isValidationError = error instanceof Error && (error.name === 'ZodError'
      || /must|exceeds|invalid|unsafe|unsupported|has no renderable|content-type/i.test(detail));
    if (isValidationError) {
      return NextResponse.json({error: detail, code: 'INVALID_RENDER_REQUEST'}, {status: 400});
    }
    return NextResponse.json({error: 'Render enqueue failed.', code: 'RENDER_ENQUEUE_FAILED'}, {status: 500});
  }
}
