import {NextRequest, NextResponse} from 'next/server';
import {POST as uploadManagedMedia} from '../upload/route';
import {createAssetCapability} from '@/app/lib/assets/asset-capability.server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const assertSameOriginUiRequest = (request: NextRequest) => {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') throw new Error('Cross-site UI upload is not allowed.');
  if (!origin || fetchSite === 'same-origin') return;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const protocol = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '');
  const forwardedOrigin = host ? `${protocol}://${host}` : request.nextUrl.origin;
  if (origin !== forwardedOrigin && origin !== request.nextUrl.origin) throw new Error('Cross-origin UI upload is not allowed.');
};

export async function POST(request: NextRequest, context: {params: Promise<{projectId: string}>}) {
  try {
    assertSameOriginUiRequest(request);
    const agentToken = process.env.CLIPJS_AGENT_TOKEN;
    const approvalToken = process.env.CLIPJS_APPROVAL_TOKEN;
    if (!agentToken || !approvalToken) throw new Error('Managed upload credentials are not configured.');

    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.length < 1 || bytes.length > 20 * 1024 * 1024) throw new Error('UI image upload exceeds the 20 MB limit.');
    const headers = new Headers(request.headers);
    headers.set('authorization', `Bearer ${agentToken}`);
    headers.set('x-clipjs-approval-token', approvalToken);
    headers.set('x-clipjs-media-kind', 'image');
    headers.set('content-length', String(bytes.length));
    headers.set('x-clipjs-byte-length', String(bytes.length));

    const internalRequest = new NextRequest(request.nextUrl, {method: 'POST', headers, body: bytes});
    const response = await uploadManagedMedia(internalRequest, context);
    const payload = await response.json() as {asset?: {id?: string; contentSha256?: string}; error?: string};
    if (!response.ok || !payload.asset?.id || !payload.asset.contentSha256) {
      return NextResponse.json({error: payload.error ?? 'Managed upload failed.'}, {status: response.status});
    }
    const {projectId} = await context.params;
    const token = createAssetCapability(projectId, payload.asset.id);
    return NextResponse.json({
      assetId: payload.asset.id,
      contentSha256: payload.asset.contentSha256,
      previewUrl: `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(payload.asset.id)}?token=${encodeURIComponent(token)}`,
    }, {status: 201});
  } catch (error) {
    console.error('UI managed upload rejected.', {name: error instanceof Error ? error.name : 'UnknownError', message: error instanceof Error ? error.message : ''});
    return NextResponse.json({error: 'Managed image upload was rejected.'}, {status: 400});
  }
}
