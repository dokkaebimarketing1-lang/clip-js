import {NextRequest, NextResponse} from 'next/server';
import {z} from 'zod';
import {getGenerationRepository} from '@/app/lib/generation/runtime.server';
import {readLimitedJson} from '@/app/lib/security/request-body';
import {signTakeApproval} from '@/app/lib/security/approval-signature';
import {takeApprovalSchema} from '@/app/lib/workflow/production-schema';

const approveSchema = z.object({
  requestKey: z.string().regex(/^[a-f0-9]{64}$/),
  assetId: z.string().min(1).max(256),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

const hasTrustedOrigin = (request: NextRequest) => {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === request.nextUrl.origin; } catch { return false; }
};

export async function POST(request: NextRequest, context: {params: Promise<{projectId: string; takeId: string}>}) {
  try {
    if (!hasTrustedOrigin(request)) return NextResponse.json({error: '교차 사이트 승인 요청은 허용되지 않습니다.'}, {status: 403});
    const {projectId, takeId} = await context.params;
    const body = approveSchema.parse(await readLimitedJson(request));
    const record = await getGenerationRepository().get(body.requestKey);
    if (!record || record.claim.projectId !== projectId || record.job.status !== 'ready') {
      return NextResponse.json({error: '검수 가능한 생성본을 찾지 못했습니다.'}, {status: 404});
    }
    if (record.job.takeId !== takeId || record.job.assetId !== body.assetId || record.job.contentSha256 !== body.contentSha256) {
      return NextResponse.json({error: '생성본의 자산 또는 해시가 서버 기록과 일치하지 않습니다.'}, {status: 409});
    }
    const unsigned = takeApprovalSchema.parse({
      status: 'approved',
      takeId,
      assetId: body.assetId,
      contentSha256: body.contentSha256,
      approvedAt: new Date().toISOString(),
      approvedBy: 'project-owner',
    });
    return NextResponse.json({takeApproval: signTakeApproval(projectId, unsigned)});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : '생성본 승인에 실패했습니다.'}, {status: 400});
  }
}
