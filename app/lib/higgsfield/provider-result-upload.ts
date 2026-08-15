import sharp from 'sharp';
import {HIGGSFIELD_WORKER_UPLOAD_MAX_BYTES} from './result-policy';

export const prepareHiggsfieldImageUpload = async (
  bytes: Uint8Array,
  type: string,
): Promise<{bytes: Uint8Array; type: string}> => {
  if (bytes.byteLength <= HIGGSFIELD_WORKER_UPLOAD_MAX_BYTES) return {bytes, type};

  for (const quality of [90, 80, 70]) {
    const compressed = await sharp(bytes, {failOn: 'error', limitInputPixels: 8192 * 8192})
      .rotate()
      .webp({quality, effort: 4})
      .toBuffer();
    if (compressed.byteLength <= HIGGSFIELD_WORKER_UPLOAD_MAX_BYTES) {
      return {bytes: new Uint8Array(compressed), type: 'image/webp'};
    }
  }

  for (const width of [1600, 1280, 1024]) {
    const compressed = await sharp(bytes, {failOn: 'error', limitInputPixels: 8192 * 8192})
      .rotate()
      .resize({width, height: width, fit: 'inside', withoutEnlargement: true})
      .webp({quality: 80, effort: 4})
      .toBuffer();
    if (compressed.byteLength <= HIGGSFIELD_WORKER_UPLOAD_MAX_BYTES) {
      return {bytes: new Uint8Array(compressed), type: 'image/webp'};
    }
  }

  throw new Error('Generated image cannot be reduced below the worker upload limit.');
};
