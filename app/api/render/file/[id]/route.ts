import path from 'node:path';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {NextRequest, NextResponse} from 'next/server';
import {verifyRenderDownloadToken} from '@/app/lib/security/api-auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, {params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({error: 'Invalid render id.'}, {status: 400});
  try {
    verifyRenderDownloadToken(id, request.nextUrl.searchParams.get('token') ?? '');
    const filePath = path.join(process.cwd(), 'renders', `${id}.mp4`);
    const metadata = await stat(filePath);
    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>;
    return new NextResponse(stream, {headers: {
      'content-type': 'video/mp4',
      'content-length': String(metadata.size),
      'content-disposition': `attachment; filename="${id}.mp4"`,
      'cache-control': 'private, no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    }});
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Render not found.';
    const status = /token|required in production/i.test(message) ? 401 : 404;
    return NextResponse.json({error: message}, {status});
  }
}
