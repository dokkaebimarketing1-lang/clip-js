import {NextRequest, NextResponse} from 'next/server';
import {authorizeAgentRequest} from '@/app/lib/security/api-auth';
import {getGeneratedAssetStore} from '@/app/lib/generation/runtime.server';
import {createAssetCapability} from '@/app/lib/assets/asset-capability.server';

export async function POST(request: NextRequest, context: {params: Promise<{projectId: string; assetId: string}>}) {
  try {
    authorizeAgentRequest(request);
    const {projectId, assetId} = await context.params;
    const asset = await getGeneratedAssetStore().get(assetId);
    if (!asset || asset.projectId !== projectId) return NextResponse.json({error: 'Asset not found.'}, {status: 404});
    const token = createAssetCapability(projectId, assetId);
    return NextResponse.json({url: `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}?token=${encodeURIComponent(token)}`, expiresInSeconds: 600});
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Asset capability failed.';
    return NextResponse.json({error: message}, {status: /Unauthorized|required/i.test(message) ? 401 : 400});
  }
}
