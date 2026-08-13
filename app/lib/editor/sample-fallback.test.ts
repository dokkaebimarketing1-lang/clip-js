import {describe, expect, it} from 'vitest';
import {shouldUseSampleFallback} from './sample-fallback';

describe('shouldUseSampleFallback', () => {
  it('명시적 sample mode이고 실제 데이터가 없을 때만 샘플을 허용한다', () => {
    expect(shouldUseSampleFallback(true, false)).toBe(true);
    expect(shouldUseSampleFallback(true, true)).toBe(false);
    expect(shouldUseSampleFallback(false, false)).toBe(false);
    expect(shouldUseSampleFallback(false, true)).toBe(false);
  });
});
