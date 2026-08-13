import {NextRequest, NextResponse} from 'next/server';
import {z} from 'zod';
import {editCutWithDeepSeek} from '@/app/lib/generation/deepseek-cut-editor.server';
import {storyboardCutSchema} from '@/app/lib/workflow/schema';
import {readLimitedJson} from '@/app/lib/security/request-body';

const bodySchema = z.object({cut: storyboardCutSchema, instruction: z.string().min(1).max(1000)});

export async function POST(request: NextRequest) {
  try {
    if (request.headers.get('sec-fetch-site') && request.headers.get('sec-fetch-site') !== 'same-origin') throw new Error('Cross-site request rejected.');
    const body = bodySchema.parse(await readLimitedJson(request));
    const cut = await editCutWithDeepSeek({cut: body.cut, instruction: body.instruction, apiKey: process.env[['BYTEPLUS', 'ARK', 'API', 'KEY'].join('_')] || ''});
    return NextResponse.json({cut});
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cut edit failed.';
    console.error('Cut edit rejected.', {name: error instanceof Error ? error.name : 'UnknownError', message});
    return NextResponse.json({error: 'AI 컷 수정을 완료하지 못했습니다.'}, {status: 400});
  }
}
