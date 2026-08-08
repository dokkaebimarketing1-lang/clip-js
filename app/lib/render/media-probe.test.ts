import {describe, expect, it, vi} from 'vitest';
vi.mock('server-only', () => ({}));
import {assertExpectedMediaStreams} from './media-probe';

describe('remote media stream validation', () => {
  it('accepts video containers with a video stream', () => {
    expect(() => assertExpectedMediaStreams('video', {streams: [{codec_type: 'video'}, {codec_type: 'audio'}]})).not.toThrow();
  });

  it('rejects audio-only containers declared as video', () => {
    expect(() => assertExpectedMediaStreams('video', {streams: [{codec_type: 'audio'}]})).toThrow('video stream');
  });

  it('rejects video containers declared as audio', () => {
    expect(() => assertExpectedMediaStreams('audio', {streams: [{codec_type: 'video'}, {codec_type: 'audio'}]})).toThrow('must not contain a video stream');
  });

  it('accepts audio-only containers declared as audio', () => {
    expect(() => assertExpectedMediaStreams('audio', {streams: [{codec_type: 'audio'}]})).not.toThrow();
  });
});
