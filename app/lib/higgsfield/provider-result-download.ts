import {lookup} from 'node:dns/promises';
import {HIGGSFIELD_IMAGE_MAX_BYTES, HIGGSFIELD_IMAGE_RESULT_HOSTS} from './result-policy';
import {isPrivateNetworkAddress} from '../security/network-address';

export const downloadHiggsfieldProviderImage = async (rawUrl: string) => {
  const url = new URL(rawUrl);
  const allowedHost = HIGGSFIELD_IMAGE_RESULT_HOSTS.some((host) => host === url.hostname);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !allowedHost) throw new Error('Provider result URL is not allowed.');
  const addresses = await lookup(url.hostname, {all: true, verbatim: true});
  if (addresses.length === 0 || addresses.some(({address}) => isPrivateNetworkAddress(address))) throw new Error('Provider result URL resolves to a blocked network address.');
  const response = await fetch(url, {redirect: 'error', signal: AbortSignal.timeout(30_000)});
  if (!response.ok || !response.body) throw new Error(`Generated image download failed: ${response.status}`);
  const type = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() || '';
  if (!type.startsWith('image/')) throw new Error('Provider result is not an image.');
  const declaredBytes = Number(response.headers.get('content-length') || 0);
  if (declaredBytes > HIGGSFIELD_IMAGE_MAX_BYTES) throw new Error('Provider result exceeds the image size limit.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > HIGGSFIELD_IMAGE_MAX_BYTES) {
      await reader.cancel();
      throw new Error('Provider result exceeds the image size limit.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {bytes, type};
};
