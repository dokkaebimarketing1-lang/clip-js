import {NextRequest, NextResponse} from 'next/server';
import {z} from 'zod';
import {defaultStyleBible} from '@/app/lib/generation/planning-runtime.server';
import {getGeneratedAssetStore} from '@/app/lib/generation/runtime.server';
import {sha256} from '@/app/lib/workflow/hash';
import {readLimitedJson} from '@/app/lib/security/request-body';

const inputSchema = z.object({
  projectId: z.string().min(1).max(128),
  anchorReferenceImageId: z.string().regex(/^ga_[a-f0-9]{32}$/),
  tone: z.string().trim().min(1).max(200),
}).strict();
const MAX_BODY_BYTES = 4 * 1024;

export const POST = async (request: NextRequest) => {
  const origin = request.headers.get('origin');
  if (request.headers.get('sec-fetch-site') !== 'same-origin' || origin !== new URL(request.url).origin) {
    return NextResponse.json({error: '잘못된 요청입니다.'}, {status: 400});
  }
  let raw: unknown;
  try { raw = await readLimitedJson(request, MAX_BODY_BYTES); } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return NextResponse.json({error: /exceeds/i.test(message) ? '요청이 너무 큽니다.' : '잘못된 요청입니다.'}, {status: /exceeds/i.test(message) ? 413 : 400});
  }
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({error: '영상 분위기를 확인할 수 없습니다.'}, {status: 400});
  const anchor = await getGeneratedAssetStore().get(parsed.data.anchorReferenceImageId);
  if (!anchor || anchor.projectId !== parsed.data.projectId || anchor.state !== 'ready' || !anchor.mimeType.startsWith('image/')) {
    return NextResponse.json({error: '현재 프로젝트의 기준 이미지를 확인할 수 없습니다.'}, {status: 409});
  }
  const fallback = defaultStyleBible(parsed.data.tone);
  const styleBible = {
    ...fallback,
    anchorReferenceImageId: anchor.id,
    anchorContentSha256: anchor.contentSha256,
    visualMedium: 'Approved style anchor image is authoritative; preserve its exact visual medium and realism level',
    realism: 'Match the approved style anchor exactly; do not independently switch between photoreal, illustration, or 3D',
    renderLanguage: 'Inherit the approved style anchor rendering language without reinterpretation',
    proportionRules: 'Preserve each identity while matching the approved style anchor character proportion system',
    lighting: 'Match the approved style anchor lighting softness, direction, exposure, and contrast',
    lensAndDepth: 'Match the approved style anchor lens perspective, framing conventions, and depth of field',
    background: 'Match the approved style anchor background treatment and reference-sheet layout',
    textureAndColor: 'Match the approved style anchor texture, material response, palette discipline, and color science',
  };
  const styleBibleHash = await sha256(styleBible);
  await getGeneratedAssetStore().setStyleLineage(parsed.data.anchorReferenceImageId, parsed.data.projectId, {
    styleBibleHash,
    styleReferenceImageIds: [],
  });
  return NextResponse.json({styleBible, styleBibleHash});
};
