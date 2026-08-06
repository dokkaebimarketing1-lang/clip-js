import {describe, expect, it} from 'vitest';
import {buildRemotionEffects, EFFECT_CATALOG} from '../../../remotion/effects';
import type {EffectSpec} from './schema';

const effect = (type: EffectSpec['type'], intensity: number): EffectSpec => ({
  id: `effect-${type}`,
  targetMediaId: 'media-1',
  type,
  provider: 'remotion',
  intensity,
  startSeconds: 0,
  endSeconds: 1,
});

describe('Remotion effect registry', () => {
  it('maps every public catalog entry to one official Remotion effect descriptor', () => {
    const specs = EFFECT_CATALOG.map((item) => effect(item.type, 0.5));
    expect(buildRemotionEffects(specs)).toHaveLength(EFFECT_CATALOG.length);
    expect(EFFECT_CATALOG.map((item) => item.type)).toEqual([
      'blur', 'chromatic-aberration', 'vignette', 'noise', 'pixelate', 'glow',
    ]);
  });

  it('keeps zero-intensity effects as descriptors that are disabled by the factory', () => {
    expect(buildRemotionEffects([effect('blur', 0)])).toHaveLength(1);
  });
});
