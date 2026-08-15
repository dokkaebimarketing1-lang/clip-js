import {describe, expect, it} from 'vitest';
import {
  calculateEastResize,
  calculateTrimmedStartTime,
  calculateWestResize,
  timelinePixelsToUnits,
} from './timeline-element-logic';

describe('timeline element east resize', () => {
  it('scales the rendered width and offsets the clip end', () => {
    const resize = calculateEastResize(2, 150, 50);

    expect(resize.resizedDuration).toBe(3);
    expect(resize.positionEnd).toBe(5);
  });

  it('preserves the existing zero and negative width behavior', () => {
    const zeroWidth = calculateEastResize(2, 0, 50);
    const negativeWidth = calculateEastResize(2, -25, 50);

    expect(zeroWidth.resizedDuration).toBe(0);
    expect(zeroWidth.positionEnd).toBe(2);
    expect(negativeWidth.resizedDuration).toBe(-0.5);
    expect(negativeWidth.positionEnd).toBe(1.5);
  });

  it('uses the current timeline zoom for duration scaling', () => {
    const resize = calculateEastResize(1, 150, 75);

    expect(resize.resizedDuration).toBe(2);
    expect(resize.positionEnd).toBe(3);
  });
});

describe('timeline element west resize', () => {
  it('moves the start and reports the source trim delta', () => {
    const resize = calculateWestResize(2, 8, 150, 50);

    expect(resize.resizedDuration).toBe(3);
    expect(resize.positionStart).toBe(5);
    expect(resize.trimDelta).toBe(3);
    expect(resize.renderedLeft).toBe(250);
    expect(resize.renderedWidth).toBe(150);
  });

  it('clamps the start at the beginning of the timeline', () => {
    const resize = calculateWestResize(2, 8, 500, 50);

    expect(resize.resizedDuration).toBe(10);
    expect(resize.positionStart).toBe(0);
    expect(resize.trimDelta).toBe(-2);
    expect(resize.renderedLeft).toBe(0);
    expect(resize.renderedWidth).toBe(400);
  });

  it('clamps the start to the minimum timeline duration', () => {
    const resize = calculateWestResize(2, 8, 0, 50);

    expect(resize.resizedDuration).toBe(0);
    expect(resize.positionStart).toBe(7.9);
    expect(resize.trimDelta).toBe(5.9);
    expect(resize.renderedLeft).toBe(395);
    expect(resize.renderedWidth).toBeCloseTo(5);
  });
});

describe('timeline element scaling and trim', () => {
  it('converts pixels to timeline units using zoom', () => {
    expect(timelinePixelsToUnits(240, 80)).toBe(3);
  });

  it('applies a west-resize trim delta without crossing the source start', () => {
    expect(calculateTrimmedStartTime(4, 1.5)).toBe(5.5);
    expect(calculateTrimmedStartTime(1, -3)).toBe(0);
  });
});
