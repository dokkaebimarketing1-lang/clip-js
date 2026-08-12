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

export type ResolveRemoteUrlOptions = {
  allowedHosts?: readonly string[];
  requireAllowlist?: boolean;
  allowlistName?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export const resolveSafeRemoteUrl = async (value: string, options: ResolveRemoteUrlOptions = {}): Promise<ResolvedRemoteUrl> => {
  options.signal?.throwIfAborted();
  const url = assertSafeRemoteUrl(value);
  const allowedHosts = options.allowedHosts
    ? [...options.allowedHosts]
    : (process.env.CLIPJS_MEDIA_HOSTS ?? '').split(',').map((host) => host.trim()).filter(Boolean);
  const requireAllowlist = options.requireAllowlist ?? process.env.NODE_ENV === 'production';
  const allowlistName = options.allowlistName ?? 'CLIPJS_MEDIA_HOSTS';
  if (requireAllowlist && allowedHosts.length === 0) {
    throw new Error(`${allowlistName} must be configured.`);
  }
  if (allowedHosts.length > 0 && !isHostnameAllowed(url.hostname, allowedHosts)) {
    throw new Error(`Remote media hostname is not in ${allowlistName}.`);
  }
  const timeoutMs = options.timeoutMs ?? 5000;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('Remote media DNS resolution timed out.')), timeoutMs);
    if (options.signal) {
      abortHandler = () => reject(options.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
      if (options.signal.aborted) abortHandler();
      else options.signal.addEventListener('abort', abortHandler, {once: true});
    }
  });
  let results: Array<{address: string; family: number}>;
  try {
    results = await Promise.race([lookup(url.hostname, {all: true, verbatim: true}), deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (abortHandler) options.signal?.removeEventListener('abort', abortHandler);
  }
  if (results.length === 0 || results.some(({address}) => isPrivateNetworkAddress(address))) {
    throw new Error('Remote media hostname resolves to a blocked network address.');
  }
  const selected = results[0];
  return {url, address: selected.address, family: selected.family === 6 ? 6 : 4};
};

export const assertSafeRemoteUrlResolved = async (value: string): Promise<URL> => (await resolveSafeRemoteUrl(value)).url;
