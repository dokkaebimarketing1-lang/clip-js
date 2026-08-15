import 'server-only';
import {lookup} from 'node:dns/promises';
import {assertSafeRemoteUrl, isHostnameAllowed} from './remote-url';
import {isPrivateNetworkAddress} from './network-address';

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
