import 'server-only';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {assertSafeRemoteUrl, isHostnameAllowed} from './remote-url';

const isPrivateIpv4 = (address: string): boolean => {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224;
};

export const isPrivateNetworkAddress = (address: string): boolean => {
  const normalized = address.toLowerCase();
  if (isIP(normalized) === 4) return isPrivateIpv4(normalized);
  if (isIP(normalized) !== 6) return true;
  if (normalized.startsWith('::ffff:')) return isPrivateIpv4(normalized.slice(7));
  const firstHextet = Number.parseInt(normalized.split(':', 1)[0], 16);
  const isGlobalUnicast = firstHextet >= 0x2000 && firstHextet <= 0x3fff;
  const isSpecialPurpose = normalized.startsWith('2001::') ||
    normalized.startsWith('2001:2:') ||
    normalized.startsWith('2001:10:') ||
    normalized.startsWith('2001:20:') ||
    normalized.startsWith('2001:db8:') ||
    normalized.startsWith('2002:');
  return !isGlobalUnicast || isSpecialPurpose;
};

export type ResolvedRemoteUrl = {url: URL; address: string; family: 4 | 6};

export const resolveSafeRemoteUrl = async (value: string): Promise<ResolvedRemoteUrl> => {
  const url = assertSafeRemoteUrl(value);
  const allowedHosts = (process.env.CLIPJS_MEDIA_HOSTS ?? '').split(',').map((host) => host.trim()).filter(Boolean);
  if (process.env.NODE_ENV === 'production' && allowedHosts.length === 0) {
    throw new Error('CLIPJS_MEDIA_HOSTS must be configured in production.');
  }
  if (allowedHosts.length > 0 && !isHostnameAllowed(url.hostname, allowedHosts)) {
    throw new Error('Remote media hostname is not in CLIPJS_MEDIA_HOSTS.');
  }
  const results = await lookup(url.hostname, {all: true, verbatim: true});
  if (results.length === 0 || results.some(({address}) => isPrivateNetworkAddress(address))) {
    throw new Error('Remote media hostname resolves to a blocked network address.');
  }
  const selected = results[0];
  return {url, address: selected.address, family: selected.family === 6 ? 6 : 4};
};

export const assertSafeRemoteUrlResolved = async (value: string): Promise<URL> => (await resolveSafeRemoteUrl(value)).url;
