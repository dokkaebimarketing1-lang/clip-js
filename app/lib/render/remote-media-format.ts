export type RemoteMediaKind = 'video' | 'audio' | 'image';

export type RemoteMediaFormat = {
  extension: string;
  contentType: string;
};

const normalizeContentType = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value ?? '').split(';', 1)[0].trim().toLowerCase();

const contentTypeMatchesKind = (kind: RemoteMediaKind, contentType: string): boolean => {
  if (contentType === 'application/octet-stream') return true;
  if (kind === 'video') return contentType.startsWith('video/');
  if (kind === 'audio') return contentType.startsWith('audio/');
  return contentType.startsWith('image/');
};

const startsWithBytes = (buffer: Buffer, bytes: readonly number[]): boolean =>
  buffer.length >= bytes.length && bytes.every((byte, index) => buffer[index] === byte);

const hasAsciiAt = (buffer: Buffer, offset: number, value: string): boolean =>
  buffer.length >= offset + value.length && buffer.subarray(offset, offset + value.length).toString('ascii') === value;

const detectByMagic = (kind: RemoteMediaKind, prefix: Buffer): RemoteMediaFormat | undefined => {
  if (kind === 'video') {
    if (hasAsciiAt(prefix, 4, 'ftyp')) {
      const brand = prefix.subarray(8, 12).toString('ascii');
      if (brand === 'qt  ') return {extension: 'mov', contentType: 'video/quicktime'};
      if (brand === 'M4V ' || brand === 'M4VH' || brand === 'M4VP') return {extension: 'm4v', contentType: 'video/x-m4v'};
      return {extension: 'mp4', contentType: 'video/mp4'};
    }
    if (startsWithBytes(prefix, [0x1a, 0x45, 0xdf, 0xa3])) return {extension: 'webm', contentType: 'video/webm'};
  }
  if (kind === 'audio') {
    if (hasAsciiAt(prefix, 0, 'ID3') || (prefix.length >= 2 && prefix[0] === 0xff && (prefix[1] & 0xe0) === 0xe0)) {
      return {extension: 'mp3', contentType: 'audio/mpeg'};
    }
    if (hasAsciiAt(prefix, 0, 'RIFF') && hasAsciiAt(prefix, 8, 'WAVE')) return {extension: 'wav', contentType: 'audio/wav'};
    if (hasAsciiAt(prefix, 0, 'OggS')) return {extension: 'ogg', contentType: 'audio/ogg'};
    if (hasAsciiAt(prefix, 4, 'ftyp')) return {extension: 'm4a', contentType: 'audio/mp4'};
  }
  if (kind === 'image') {
    if (startsWithBytes(prefix, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return {extension: 'png', contentType: 'image/png'};
    if (startsWithBytes(prefix, [0xff, 0xd8, 0xff])) return {extension: 'jpg', contentType: 'image/jpeg'};
    if (hasAsciiAt(prefix, 0, 'GIF87a') || hasAsciiAt(prefix, 0, 'GIF89a')) return {extension: 'gif', contentType: 'image/gif'};
    if (hasAsciiAt(prefix, 0, 'RIFF') && hasAsciiAt(prefix, 8, 'WEBP')) return {extension: 'webp', contentType: 'image/webp'};
  }
  return undefined;
};

export const detectRemoteMediaFormat = (
  kind: RemoteMediaKind,
  declaredContentType: string | string[] | undefined,
  prefix: Buffer,
): RemoteMediaFormat => {
  const contentType = normalizeContentType(declaredContentType);
  if (!contentType || !contentTypeMatchesKind(kind, contentType)) {
    throw new Error(`Remote ${kind} Content-Type does not match the declared media type.`);
  }
  const detected = detectByMagic(kind, prefix);
  if (!detected) throw new Error(`Remote ${kind} file signature is unsupported or invalid.`);
  return detected;
};
