import {beforeAll, describe, expect, it, vi} from 'vitest';
vi.mock('server-only', () => ({}));
import {openTransportUrl, sealTransportUrl} from './transport-seal.server';

beforeAll(() => { process.env.CLIPJS_TRANSPORT_URL_ENCRYPTION_KEY = 'transport-test-key'; });

describe('transport URL envelope', () => {
  it('round-trips HTTPS URLs without persisting plaintext', () => {
    const url = 'https://results.example.com/file.mp4?signature=secret';
    const envelope = sealTransportUrl(url);
    expect(envelope).toMatch(/^v1\./);
    expect(envelope).not.toContain('results.example.com');
    expect(openTransportUrl(envelope)).toBe(url);
  });

  it('rejects tampered envelopes and non-HTTPS URLs', () => {
    const envelope = sealTransportUrl('https://results.example.com/file.mp4');
    const parts = envelope.split('.');
    parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;
    expect(() => openTransportUrl(parts.join('.'))).toThrow();
    expect(() => sealTransportUrl('http://results.example.com/file.mp4')).toThrow(/HTTPS/i);
  });
});
