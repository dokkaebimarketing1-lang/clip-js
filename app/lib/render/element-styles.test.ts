import {describe, expect, it} from 'vitest';
import type {MediaFile, TextElement} from '@/app/types';
import {mediaVisualStyle, textVisualStyle} from '@/remotion/element-styles';

const media: MediaFile = {
  id: 'media',
  fileName: 'media.mp4',
  type: 'video',
  startTime: 0,
  endTime: 2,
  positionStart: 0,
  positionEnd: 2,
  includeInMerge: true,
  playbackSpeed: 1,
  volume: 100,
  zIndex: 2,
  opacity: 100,
  rotation: 12,
};

const text: TextElement = {
  id: 'text',
  text: 'Title',
  positionStart: 0,
  positionEnd: 2,
  x: 100,
  y: 200,
};

describe('Remotion element style mapping', () => {
  it('preserves legacy media geometry when optional state is absent', () => {
    const style = mediaVisualStyle(media, {width: 1920, height: 1080});

    expect(style).toMatchObject({left: 0, top: 0, width: '100%', height: '100%', transform: 'rotate(12deg)'});
    expect(style.clipPath).toBeUndefined();
  });

  it('maps media transform and crop into final CSS', () => {
    const style = mediaVisualStyle({
      ...media,
      transform: {x: 0.25, y: -0.1, rotation: 30, scale: 1.5},
      crop: {left: 0.1, top: 0.2, width: 0.6, height: 0.5},
    }, {width: 1920, height: 1080});

    expect(style.transform).toBe('translate(480px, -108px) rotate(30deg) scale(1.5)');
    expect(style.clipPath).toBe('inset(20% 30% 30% 10%)');
  });

  it('maps text transform without changing its base placement', () => {
    const style = textVisualStyle({
      ...text,
      transform: {x: -0.05, y: 0.1, rotation: -8, scale: 0.9},
    }, {width: 1920, height: 1080});

    expect(style).toMatchObject({left: 100, top: 200, transform: 'translate(-96px, 108px) rotate(-8deg) scale(0.9)'});
  });
});
