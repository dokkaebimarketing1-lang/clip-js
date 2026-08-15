import {beforeEach, describe, expect, it, vi} from 'vitest';
import {HIGGSFIELD_IMAGE_MAX_BYTES, HIGGSFIELD_IMAGE_RESULT_HOSTS} from './result-policy';

const {lookup} = vi.hoisted(() => ({lookup: vi.fn()}));
vi.mock('node:dns/promises', () => ({lookup}));

import {downloadHiggsfieldProviderImage} from './provider-result-download';

const allowedUrl = `https://${HIGGSFIELD_IMAGE_RESULT_HOSTS[0]}/result.png`;

beforeEach(() => {
  vi.restoreAllMocks();
  lookup.mockReset().mockResolvedValue([{address: '13.32.1.1', family: 4}]);
});

describe('Higgsfield provider result download', () => {
  it('rejects untrusted and private-network destinations before fetch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(downloadHiggsfieldProviderImage('http://127.0.0.1/internal')).rejects.toThrow(/not allowed/i);
    lookup.mockResolvedValueOnce([{address: '127.0.0.1', family: 4}]);
    await expect(downloadHiggsfieldProviderImage(allowedUrl)).rejects.toThrow(/blocked network/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('downloads only a bounded image without following redirects', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(bytes, {
      status: 200,
      headers: {'content-type': 'image/png', 'content-length': String(bytes.byteLength)},
    }));

    await expect(downloadHiggsfieldProviderImage(allowedUrl)).resolves.toMatchObject({type: 'image/png', bytes});
    expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({redirect: 'error'}));
  });

  it('rejects oversized provider responses before reading the body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(new Uint8Array([1]), {
      status: 200,
      headers: {'content-type': 'image/png', 'content-length': String(HIGGSFIELD_IMAGE_MAX_BYTES + 1)},
    }));
    await expect(downloadHiggsfieldProviderImage(allowedUrl)).rejects.toThrow(/size limit/i);
  });
});
