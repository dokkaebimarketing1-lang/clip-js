import {describe, expect, it} from 'vitest';
import type {MediaFile} from '@/app/types';
import {buildDetachedAudioMedia, hasDetachedAudio} from './detach-audio';

const video: MediaFile = {
  id: 'video-1',
  fileName: 'interview.mp4',
  source: {kind: 'managed', assetId: 'asset-1'},
  src: 'blob:interview',
  remoteUrl: 'https://example.com/interview.mp4',
  type: 'video',
  startTime: 2,
  endTime: 12,
  positionStart: 5,
  positionEnd: 15,
  includeInMerge: false,
  playbackSpeed: 1.25,
  volume: 72,
  zIndex: 4,
};

describe('detach audio', () => {
  it('derives an audio media file with the same source and timeline fields', () => {
    const result = buildDetachedAudioMedia(video, 'audio-1');

    expect(result.audio).toMatchObject({
      id: 'audio-1',
      fileName: 'interview.mp4-오디오',
      type: 'audio',
      src: video.src,
      remoteUrl: video.remoteUrl,
      startTime: video.startTime,
      endTime: video.endTime,
      positionStart: video.positionStart,
      positionEnd: video.positionEnd,
      includeInMerge: video.includeInMerge,
      playbackSpeed: video.playbackSpeed,
    });
    expect(result.audio.source).toBe(video.source);
  });

  it('moves the audible volume to the derived audio', () => {
    const result = buildDetachedAudioMedia(video, 'audio-1');

    expect(result.video.volume).toBe(0);
    expect(result.audio.volume).toBe(video.volume);
    expect(video.volume).toBe(72);
  });

  it('places the derived audio one layer below the video', () => {
    const result = buildDetachedAudioMedia(video, 'audio-1');

    expect(result.audio.zIndex).toBe(video.zIndex - 1);
  });

  it('detects only a matching derived audio for the same source and position', () => {
    const {audio} = buildDetachedAudioMedia(video, 'audio-1');
    const matchingAudio = {...audio, source: {kind: 'managed' as const, assetId: 'asset-1'}};
    const differentSource = {...audio, source: {kind: 'managed' as const, assetId: 'asset-2'}};

    expect(hasDetachedAudio([video, matchingAudio], video)).toBe(true);
    expect(hasDetachedAudio([video, differentSource], video)).toBe(false);
  });
});
