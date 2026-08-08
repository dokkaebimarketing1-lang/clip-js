import {describe, expect, it} from 'vitest';
import {captionBounds, captionStackStyle} from '../../../remotion/captions';

describe('narration caption balance', () => {
  it('stacks the speaker label above a horizontally centered caption body', () => {
    const style = captionStackStyle(true, 720);
    expect(style.display).toBe('flex');
    expect(style.flexDirection).toBe('column');
    expect(style.alignItems).toBe('center');
    expect(style.rowGap).toBeGreaterThan(0);
  });
});

describe('caption safe area', () => {
  it('uses larger horizontal and vertical margins when safeArea is enabled', () => {
    const safe = captionBounds('bottom', true, 1920, 1080);
    const edge = captionBounds('bottom', false, 1920, 1080);
    expect(safe.left).toBeGreaterThan(edge.left as number);
    expect(safe.width).toBeLessThan(edge.width as number);
    expect(safe.bottom).toBeGreaterThan(edge.bottom as number);
  });

  it('reserves the upper-right corner for source overlays', () => {
    const top = captionBounds('top', true, 1920, 1080);
    expect(top.left).toBeCloseTo(134.4);
    expect(top.width).toBeCloseTo(1305.6);
  });
});
