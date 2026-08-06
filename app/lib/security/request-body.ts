import type {NextRequest} from 'next/server';

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

export const readLimitedJson = async (request: NextRequest, maxBytes = DEFAULT_MAX_BYTES): Promise<unknown> => {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('Request body exceeds the 10MB limit.');
  if (!request.body) throw new Error('Request body is required.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('Request body exceeds the 10MB limit.');
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(merged));
  } catch {
    throw new Error('Request body is not valid JSON.');
  }
};
