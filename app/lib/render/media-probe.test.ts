import {afterEach, describe, expect, it, vi} from 'vitest';
vi.mock('server-only', () => ({}));
import {assertExpectedMediaStreams, assertGeneratedVideoProbe, verifyStagedMediaStreams} from './media-probe';

type RichProbeStream = {
  codec_type?: string; codec_name?: string; width?: number; height?: number;
  r_frame_rate?: string; avg_frame_rate?: string; duration?: string;
};
type RichProbeResult = {
  format?: {format_name?: string; duration?: string; size?: string};
  streams: RichProbeStream[];
};

const savedProbePath = process.env.CLIPJS_FFPROBE_PATH;
afterEach(() => {
  if (savedProbePath === undefined) delete process.env.CLIPJS_FFPROBE_PATH;
  else process.env.CLIPJS_FFPROBE_PATH = savedProbePath;
});

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

  it('reports an actionable error when ffprobe is unavailable', async () => {
    process.env.CLIPJS_FFPROBE_PATH = 'definitely-missing-clipjs-ffprobe';
    await expect(verifyStagedMediaStreams('missing.mp4', 'video')).rejects.toThrow('ffprobe is unavailable');
  });
});

describe('generated video rich probe validation', () => {
  const valid = (): RichProbeResult => ({
    format: {format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '30.04', size: '1000'},
    streams: [
      {codec_type: 'video', codec_name: 'h264', width: 1280, height: 720, r_frame_rate: '24/1', avg_frame_rate: '24/1', duration: '30.04'},
      {codec_type: 'audio', codec_name: 'aac', duration: '30.04'},
    ],
  });

  it('accepts one bounded H.264 video plus optional AAC audio', () => {
    expect(assertGeneratedVideoProbe(valid(), 30)).toMatchObject({width: 1280, height: 720, fps: 24, videoStreams: 1, audioStreams: 1});
    const silent = valid();
    silent.streams.pop();
    expect(assertGeneratedVideoProbe(silent, 30).audioStreams).toBe(0);
  });

  it('rejects subtitles, unsafe codec, fps, resolution, and duration mismatch', () => {
    const subtitle = valid(); subtitle.streams.push({codec_type: 'subtitle', codec_name: 'mov_text'});
    expect(() => assertGeneratedVideoProbe(subtitle, 30)).toThrow(/one video stream and at most one audio/i);
    const codec = valid(); codec.streams[0].codec_name = 'mpeg2video';
    expect(() => assertGeneratedVideoProbe(codec, 30)).toThrow(/codec/i);
    const fps = valid(); fps.streams[0].avg_frame_rate = '120/1';
    expect(() => assertGeneratedVideoProbe(fps, 30)).toThrow(/frame rate/i);
    const resolution = valid(); resolution.streams[0].width = 8192;
    expect(() => assertGeneratedVideoProbe(resolution, 30)).toThrow(/resolution/i);
    const shortAudio = valid(); shortAudio.streams[1].duration = '1';
    expect(() => assertGeneratedVideoProbe(shortAudio, 30)).toThrow(/audio stream duration/i);
    expect(() => assertGeneratedVideoProbe(valid(), 20)).toThrow(/duration does not match/i);
  });
});
