import {NextRequest, NextResponse} from 'next/server';
import {createAssetCapability} from '@/app/lib/assets/asset-capability.server';
import {getGeneratedAssetStore} from '@/app/lib/generation/runtime.server';

const assertSameOrigin = (request: NextRequest) => {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (origin && origin !== request.nextUrl.origin) throw new Error('Cross-origin capability request is not allowed.');
  if (fetchSite && fetchSite !== 'same-origin') throw new Error('Cross-origin capability request is not allowed.');
};

export async function POST(request: NextRequest, context: {params: Promise<{projectId: string; assetId: string}>}) {
  try {
    assertSameOrigin(request);
    const {projectId, assetId} = await context.params;
    const asset = await getGeneratedAssetStore().get(assetId);
    if (!asset || asset.projectId !== projectId) return NextResponse.json({error: 'Asset not found.'}, {status: 404});
    const token = createAssetCapability(projectId, assetId);
    return NextResponse.json({url: `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}?token=${encodeURIComponent(token)}`, expiresInSeconds: 600});
  } catch {
    return NextResponse.json({error: 'Asset preview is unavailable.'}, {status: 400});
  }
}
