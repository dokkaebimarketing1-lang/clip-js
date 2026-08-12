import {createHmac, timingSafeEqual} from 'node:crypto';

const secret = (): string => {
  const value = process.env.CLIPJS_ASSET_CAPABILITY_SECRET;
  if (!value) throw new Error('CLIPJS_ASSET_CAPABILITY_SECRET is required.');
  return value;
};

const signature = (projectId: string, assetId: string, expiresAt: number): string =>
  createHmac('sha256', secret()).update(`${projectId}.${assetId}.${expiresAt}`).digest('hex');

export const createAssetCapability = (projectId: string, assetId: string, ttlSeconds = 600, now = new Date()): string => {
  if (!projectId || !/^ga_[a-f0-9]{32}$/.test(assetId) || ttlSeconds < 1 || ttlSeconds > 600) throw new Error('Invalid asset capability request.');
  const expiresAt = Math.floor(now.getTime() / 1000) + ttlSeconds;
  return `${expiresAt}.${signature(projectId, assetId, expiresAt)}`;
};

export const verifyAssetCapability = (projectId: string, assetId: string, token: string, now = new Date()): void => {
  const [expiresRaw, provided, extra] = token.split('.');
  const expiresAt = Number(expiresRaw);
  if (extra !== undefined || !Number.isInteger(expiresAt) || expiresAt < Math.floor(now.getTime() / 1000) || !/^[a-f0-9]{64}$/.test(provided ?? '')) {
    throw new Error('Asset capability is expired or invalid.');
  }
  const expected = signature(projectId, assetId, expiresAt);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('Asset capability is expired or invalid.');
};
