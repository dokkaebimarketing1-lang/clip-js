import {NextRequest, NextResponse} from 'next/server';
import {assertVideoGenerationAllowed} from '@/app/lib/workflow/approval';
import {parseRenderProjectRequest} from '@/app/lib/workflow/project-file';
import {assertSafeRemoteUrlResolved} from '@/app/lib/security/remote-url.server';
import {authorizeAgentRequest, createRenderDownloadToken} from '@/app/lib/security/api-auth';
import {renderApprovedProject} from '@/app/lib/render/remotion';
import {assertRenderLimits} from '@/app/lib/render/limits';
import {verifyStoryboardApprovalSignature} from '@/app/lib/security/approval-signature';
import {readLimitedJson} from '@/app/lib/security/request-body';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    authorizeAgentRequest(request);
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
    const message = error instanceof Error ? error.message : 'Render failed.';
    const status = /Unauthorized|TOKEN/.test(message) ? 401 : 400;
    return NextResponse.json({error: message}, {status});
  }
}
