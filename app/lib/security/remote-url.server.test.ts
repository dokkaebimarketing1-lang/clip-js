import {describe, expect, it, vi} from 'vitest';
vi.mock('server-only', () => ({}));
import {resolveSafeRemoteUrl} from './remote-url.server';

describe('remote URL resolution cancellation', () => {
  it('rejects an already-aborted signal before DNS lookup', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('cancelled', 'AbortError'));
    await expect(resolveSafeRemoteUrl('https://results.example.com/video.mp4', {
      allowedHosts: ['results.example.com'], requireAllowlist: true, signal: controller.signal,
    })).rejects.toMatchObject({name: 'AbortError'});
  });
});
