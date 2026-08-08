import {describe, expect, it} from 'vitest';
import type {NextRequest} from 'next/server';
import {readLimitedJson} from './request-body';

const request = (body: string, headers: Record<string, string> = {}): NextRequest =>
  new Request('http://localhost/api', {method: 'POST', body, headers}) as unknown as NextRequest;

describe('readLimitedJson', () => {
  it('accepts application/json with a charset', async () => {
    await expect(readLimitedJson(request('{"ok":true}', {'content-type': 'application/json; charset=utf-8'}))).resolves.toEqual({ok: true});
  });

  it('rejects non-JSON content types', async () => {
    await expect(readLimitedJson(request('{"ok":true}', {'content-type': 'text/plain'}))).rejects.toThrow('application/json');
  });

  it('rejects streamed bodies over the actual byte limit', async () => {
    await expect(readLimitedJson(request('{"long":"value"}', {'content-type': 'application/json'}), 8)).rejects.toThrow('byte limit');
  });
});
