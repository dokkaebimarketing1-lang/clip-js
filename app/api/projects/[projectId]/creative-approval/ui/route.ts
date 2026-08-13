import {NextRequest, NextResponse} from 'next/server';
import {z} from 'zod';
import {approveCreative} from '@/app/lib/workflow/approval';
import {characterSheetSchema, storyboardSchema} from '@/app/lib/workflow/schema';
import {signCreativeApproval} from '@/app/lib/security/approval-signature';
import {readLimitedJson} from '@/app/lib/security/request-body';

const requestSchema = z.object({
  storyboard: storyboardSchema,
  characterSheets: z.array(characterSheetSchema).min(1).max(10),
}).strict();

const assertSameOrigin = (request: NextRequest) => {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite !== 'same-origin' || origin !== request.nextUrl.origin) {
    throw new Error('Cross-site approval request rejected.');
  }
};

export async function POST(request: NextRequest, context: {params: Promise<{projectId: string}>}) {
  try {
    assertSameOrigin(request);
    const {projectId} = await context.params;
    const {storyboard, characterSheets} = requestSchema.parse(await readLimitedJson(request));
    const creativeApproval = signCreativeApproval(
      projectId,
      await approveCreative(storyboard, 'project-owner', new Date(), characterSheets),
    );
    return NextResponse.json({creativeApproval});
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Creative approval failed.';
    const status = /Cross-site/i.test(message) ? 403 : 400;
    return NextResponse.json({error: message}, {status});
  }
}
