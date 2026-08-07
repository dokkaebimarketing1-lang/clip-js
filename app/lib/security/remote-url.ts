const blockedHostnames = new Set(['localhost', 'localhost.localdomain']);
const privateIpv4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
];

export const assertSafeRemoteUrl = (rawUrl: string): URL => {
  if (rawUrl.length > 4096) throw new Error('Remote media URL is too long.');
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid media URL.');
  }
  if (url.protocol !== 'https:') throw new Error('Only HTTPS media URLs are allowed.');
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (blockedHostnames.has(hostname) || hostname.endsWith('.local')) throw new Error('Local network media URLs are blocked.');
  const looksLikeIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
  if (looksLikeIp) {
    if (privateIpv4.some((pattern) => pattern.test(hostname)) || hostname === '::1' || hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80:')) {
      throw new Error('Private network media URLs are blocked.');
    }
  }
  if (url.username || url.password) throw new Error('Credential-bearing media URLs are blocked.');
  return url;
};

export const isHostnameAllowed = (hostname: string, patterns: string[]): boolean => {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return patterns.some((pattern) => {
    const candidate = pattern.trim().toLowerCase().replace(/\.$/, '');
    if (!candidate) return false;
    if (candidate.startsWith('*.')) {
      const suffix = candidate.slice(2);
      return normalized.endsWith(`.${suffix}`) && normalized !== suffix;
    }
    return normalized === candidate;
  });
};
