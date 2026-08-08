import {describe, expect, it} from 'vitest';
import {detectRemoteMediaFormat} from './remote-media-format';

const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.from('isom')]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const mp3 = Buffer.from('ID3\u0004\u0000\u0000', 'binary');

describe('detectRemoteMediaFormat', () => {
  it('accepts an MP4 only for a video media item', () => {
    expect(detectRemoteMediaFormat('video', 'video/mp4', mp4)).toEqual({extension: 'mp4', contentType: 'video/mp4'});
    expect(() => detectRemoteMediaFormat('image', 'video/mp4', mp4)).toThrow('does not match');
  });

  it('uses magic bytes rather than a misleading file extension', () => {
    expect(detectRemoteMediaFormat('image', 'application/octet-stream', jpeg)).toEqual({extension: 'jpg', contentType: 'image/jpeg'});
    expect(detectRemoteMediaFormat('audio', 'audio/mpeg', mp3)).toEqual({extension: 'mp3', contentType: 'audio/mpeg'});
  });

  it('rejects HTML or unknown bytes even when the server claims video', () => {
    expect(() => detectRemoteMediaFormat('video', 'video/mp4', Buffer.from('<!doctype html>'))).toThrow('signature');
    expect(() => detectRemoteMediaFormat('video', 'text/html', mp4)).toThrow('Content-Type');
  });
});
