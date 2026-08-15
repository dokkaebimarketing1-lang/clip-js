import {describe, expect, it} from 'vitest';
import {
  cropFromInsetClipStyles,
  cropToClipPath,
  elementTransformCss,
} from './element-geometry';

describe('editor element geometry', () => {
  it('maps normalized translation to composition pixels', () => {
    const css = elementTransformCss(
      {x: 0.25, y: -0.1, rotation: 30, scale: 1.5},
      {width: 1920, height: 1080},
    );

    expect(css).toBe('translate(480px, -108px) rotate(30deg) scale(1.5)');
  });

  it('maps normalized crop to a CSS inset rectangle', () => {
    const clipPath = cropToClipPath({left: 0.1, top: 0.2, width: 0.6, height: 0.5});

    expect(clipPath).toBe('inset(20% 30% 30% 10%)');
  });

  it('maps Moveable inset controls back to normalized crop state', () => {
    const crop = cropFromInsetClipStyles(['20%', '30%', '30%', '10%']);

    expect(crop).toEqual({left: 0.1, top: 0.2, width: 0.6, height: 0.5});
  });

  it('clamps Moveable floating-point noise at media bounds', () => {
    const crop = cropFromInsetClipStyles(['8.04344%', '-3.8e-05%', '-3.8e-05%', '8.04344%']);

    expect(crop).toEqual({left: 0.080434, top: 0.080434, width: 0.919566, height: 0.919566});
  });

  it('keeps absent optional geometry visually neutral', () => {
    expect(elementTransformCss(undefined, {width: 1920, height: 1080})).toBeUndefined();
    expect(cropToClipPath(undefined)).toBeUndefined();
  });
});
