import {describe, expect, it} from 'vitest';
import {captionStackStyle} from '../../../remotion/captions';

describe('narration caption balance', () => {
  it('stacks the speaker label above a horizontally centered caption body', () => {
    const style = captionStackStyle(true, 720);
    expect(style.display).toBe('flex');
    expect(style.flexDirection).toBe('column');
    expect(style.alignItems).toBe('center');
    expect(style.rowGap).toBeGreaterThan(0);
  });
});
