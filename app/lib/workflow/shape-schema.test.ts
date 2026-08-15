import {describe, expect, it} from 'vitest';
import {shapeElementSchema} from './schema';

describe('shape element schema', () => {
  it('accepts a valid transformed shape', () => {
    const shape = {
      id: 'shape-1',
      type: 'circle',
      positionStart: 1,
      positionEnd: 4,
      x: 100,
      y: 120,
      width: 240,
      height: 240,
      color: '#d946ef',
      opacity: 80,
      zIndex: 2,
      transform: {x: 0.1, y: -0.2, rotation: 15, scale: 1.25},
    };

    expect(shapeElementSchema.parse(shape)).toEqual(shape);
  });

  it('rejects a shape with a non-positive timeline range', () => {
    expect(() => shapeElementSchema.parse({
      id: 'shape-1',
      type: 'rect',
      positionStart: 2,
      positionEnd: 2,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      color: '#ffffff',
      opacity: 100,
      zIndex: 0,
    })).toThrow();
  });
});
