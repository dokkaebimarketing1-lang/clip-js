import {describe, expect, it} from 'vitest';
import {randomBytes} from 'node:crypto';
import sharp from 'sharp';
import {HIGGSFIELD_WORKER_UPLOAD_MAX_BYTES} from './result-policy';
import {prepareHiggsfieldImageUpload} from './provider-result-upload';

describe('prepareHiggsfieldImageUpload', () => {
  it('preserves an already upload-safe image', async () => {
    const bytes = await sharp({create: {width: 32, height: 32, channels: 3, background: '#123456'}}).png().toBuffer();
    const prepared = await prepareHiggsfieldImageUpload(bytes, 'image/png');
    expect(prepared.bytes).toEqual(bytes);
    expect(prepared.type).toBe('image/png');
  });

  it('compresses an oversized valid image below the Vercel multipart budget', async () => {
    const pixels = randomBytes(2048 * 2048 * 3);
    const oversized = await sharp(pixels, {raw: {width: 2048, height: 2048, channels: 3}}).png({compressionLevel: 0}).toBuffer();
    expect(oversized.byteLength).toBeGreaterThan(HIGGSFIELD_WORKER_UPLOAD_MAX_BYTES);

    const prepared = await prepareHiggsfieldImageUpload(oversized, 'image/png');

    expect(prepared.bytes.byteLength).toBeLessThanOrEqual(HIGGSFIELD_WORKER_UPLOAD_MAX_BYTES);
    expect(prepared.type).toBe('image/webp');
    await expect(sharp(prepared.bytes).metadata()).resolves.toMatchObject({format: 'webp'});
  });
});
