import {describe, expect, it} from 'vitest';
import type {ShapeElement} from '@/app/types';
import {shapeVisualStyle} from './shape-style';

const shape = (type: ShapeElement['type']): ShapeElement => ({
  id: type,
  type,
  positionStart: 0,
  positionEnd: 2,
  x: 100,
  y: 200,
  width: 320,
  height: type === 'line' ? 4 : 180,
  color: '#d946ef',
  opacity: 75,
  zIndex: 3,
});

describe('shape visual style mapping', () => {
  it('maps rectangle geometry and fill into CSS', () => {
    expect(shapeVisualStyle(shape('rect'), {width: 1920, height: 1080})).toMatchObject({
      left: 100,
      top: 200,
      width: 320,
      height: 180,
      backgroundColor: '#d946ef',
      borderRadius: 0,
      opacity: 0.75,
      zIndex: 3,
    });
  });

  it('maps circles to a round CSS box', () => {
    expect(shapeVisualStyle(shape('circle'), {width: 1920, height: 1080}).borderRadius).toBe('50%');
  });

  it('maps lines to a thin rounded CSS box', () => {
    expect(shapeVisualStyle(shape('line'), {width: 1920, height: 1080})).toMatchObject({
      width: 320,
      height: 4,
      borderRadius: 9999,
    });
  });

  it('applies normalized transforms without changing base placement', () => {
    const style = shapeVisualStyle({
      ...shape('rect'),
      transform: {x: -0.05, y: 0.1, rotation: -8, scale: 0.9},
    }, {width: 1920, height: 1080});

    expect(style).toMatchObject({
      left: 100,
      top: 200,
      transform: 'translate(-96px, 108px) rotate(-8deg) scale(0.9)',
    });
  });
});
