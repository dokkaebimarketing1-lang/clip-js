import 'server-only';
import {createCipheriv, createDecipheriv, createHash, randomBytes} from 'node:crypto';

const key = (): Buffer => {
  const secret = process.env.CLIPJS_TRANSPORT_URL_ENCRYPTION_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('CLIPJS_TRANSPORT_URL_ENCRYPTION_KEY is not configured.');
    return createHash('sha256').update('clipjs-non-production-transport-key', 'utf8').digest();
  }
  return createHash('sha256').update(secret, 'utf8').digest();
};

export const sealTransportUrl = (url: string): string => {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Only HTTPS transport URLs may be sealed.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(url, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), ciphertext.toString('base64url'), tag.toString('base64url')].join('.');
};

export const openTransportUrl = (envelope: string): string => {
  const [version, ivText, cipherText, tagText] = envelope.split('.');
  if (version !== 'v1' || !ivText || !cipherText || !tagText) throw new Error('Invalid transport URL envelope.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  const url = Buffer.concat([decipher.update(Buffer.from(cipherText, 'base64url')), decipher.final()]).toString('utf8');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Decrypted transport URL is not HTTPS.');
  return url;
};
