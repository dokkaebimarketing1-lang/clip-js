import {NextRequest, NextResponse} from 'next/server';
import {assertVideoGenerationAllowed} from '@/app/lib/workflow/approval';
import {parseRenderProjectRequest} from '@/app/lib/workflow/project-file';
import {assertSafeRemoteUrlResolved} from '@/app/lib/security/remote-url.server';
import {authorizeAgentRequest, authorizeApprovalRequest, createRenderDownloadToken} from '@/app/lib/security/api-auth';
import {renderApprovedProject} from '@/app/lib/render/remotion';
import {assertRenderLimits} from '@/app/lib/render/limits';
import {verifyStoryboardApprovalSignature} from '@/app/lib/security/approval-signature';
import {readLimitedJson} from '@/app/lib/security/request-body';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    authorizeAgentRequest(request);
    authorizeApprovalRequest(request);
    const project = parseRenderProjectRequest(await readLimitedJson(request));
    verifyStoryboardApprovalSignature(project.id, project.workflow.approval);
    await assertVideoGenerationAllowed(project.workflow);
    assertRenderLimits(project);
    for (const media of project.mediaFiles) {
      if (!media.remoteUrl) throw new Error(`Media ${media.id} has no renderable remote URL.`);
      await assertSafeRemoteUrlResolved(media.remoteUrl);
    }
    const result = await renderApprovedProject(project);
    const downloadToken = createRenderDownloadToken(result.renderId);
    const query = downloadToken ? `?token=${encodeURIComponent(downloadToken)}` : '';
    return NextResponse.json({renderId: result.renderId, downloadUrl: `/api/render/file/${result.renderId}${query}`});
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown render error.';
    console.error('Render request failed:', error);
    if (/Unauthorized|CLIPJS_.*TOKEN/i.test(detail)) {
      return NextResponse.json({error: 'Unauthorized.', code: 'UNAUTHORIZED'}, {status: 401});
    }
    if (/approval|approved|server-signed/i.test(detail)) {
      return NextResponse.json({error: detail, code: 'APPROVAL_REQUIRED'}, {status: 403});
    }
    if (/queue is full/i.test(detail)) {
      return NextResponse.json({error: detail, code: 'RENDER_BUSY'}, {status: 503, headers: {'retry-after': '30'}});
    }
    if (/timed out|timeout/i.test(detail)) {
      return NextResponse.json({error: 'Render timed out.', code: 'RENDER_TIMEOUT'}, {status: 504});
    }
    const isValidationError = error instanceof Error && (error.name === 'ZodError'
      || /must|exceeds|invalid|unsafe|unsupported|has no renderable|content-type/i.test(detail));
    if (isValidationError) {
      return NextResponse.json({error: detail, code: 'INVALID_RENDER_REQUEST'}, {status: 400});
    }
    return NextResponse.json({error: 'Render failed.', code: 'RENDER_FAILED'}, {status: 500});
  }
}
