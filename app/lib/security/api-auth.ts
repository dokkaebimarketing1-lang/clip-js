import {createHmac, timingSafeEqual} from 'node:crypto';
import type {NextRequest} from 'next/server';

const safeEqual = (left: string, right: string): boolean => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

export const authorizeAgentRequest = (request: NextRequest): void => {
  const expected = process.env.CLIPJS_AGENT_TOKEN;
  if (!expected) {
    if (process.env.NODE_ENV === 'production') throw new Error('CLIPJS_AGENT_TOKEN is required in production.');
    return;
  }
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!safeEqual(provided, expected)) throw new Error('Unauthorized.');
};

export const authorizeApprovalRequest = (request: NextRequest): void => {
  const expected = process.env.CLIPJS_APPROVAL_TOKEN;
  if (!expected) {
    if (process.env.NODE_ENV === 'production') throw new Error('CLIPJS_APPROVAL_TOKEN is required in production.');
    return;
  }
  const provided = request.headers.get('x-clipjs-approval-token') ?? '';
  if (!safeEqual(provided, expected)) throw new Error('Unauthorized approval request.');
};

export const createRenderDownloadToken = (renderId: string, ttlSeconds = 600): string => {
  const secret = process.env.CLIPJS_AGENT_TOKEN;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('CLIPJS_AGENT_TOKEN is required in production.');
    return '';
  }
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = createHmac('sha256', secret).update(`${renderId}.${expiresAt}`).digest('hex');
  return `${expiresAt}.${signature}`;
};

export const verifyRenderDownloadToken = (renderId: string, token: string): void => {
  const secret = process.env.CLIPJS_AGENT_TOKEN;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('CLIPJS_AGENT_TOKEN is required in production.');
    return;
  }
  const [expiresRaw, signature = ''] = token.split('.', 2);
  const expiresAt = Number(expiresRaw);
  if (!Number.isInteger(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) throw new Error('Render download token is expired or invalid.');
  const expected = createHmac('sha256', secret).update(`${renderId}.${expiresAt}`).digest('hex');
  if (!safeEqual(signature, expected)) throw new Error('Render download token is expired or invalid.');
};
