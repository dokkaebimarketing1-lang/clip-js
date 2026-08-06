import {blur} from '@remotion/effects/blur';
import {chromaticAberration} from '@remotion/effects/chromatic-aberration';
import {glow} from '@remotion/effects/glow';
import {noise} from '@remotion/effects/noise';
import {pixelate} from '@remotion/effects/pixelate';
import {vignette} from '@remotion/effects/vignette';
import type {EffectDescriptor} from 'remotion';
import type {EffectSpec} from '../app/lib/workflow/schema';
import {EFFECT_CATALOG} from '../app/lib/workflow/effect-catalog';

export {EFFECT_CATALOG};

const descriptorFor = (effect: EffectSpec): EffectDescriptor<unknown> => {
  const intensity = Math.min(1, Math.max(0, effect.intensity));
  const disabled = intensity === 0;
  switch (effect.type) {
    case 'blur':
      return blur({radius: intensity * 40, disabled});
    case 'chromatic-aberration':
      return chromaticAberration({amount: intensity * 24, disabled});
    case 'vignette':
      return vignette({amount: intensity, radius: 0.72 - intensity * 0.22, feather: 0.35, disabled});
    case 'noise':
      return noise({amount: intensity * 0.5, seed: 17, disabled});
    case 'pixelate':
      return pixelate({blockSize: Math.max(1, Math.round(1 + intensity * 39)), disabled});
    case 'glow':
      return glow({radius: intensity * 40, intensity: intensity * 2, threshold: 0.2, disabled});
  }
};

export const activeEffectsAt = (
  effects: readonly EffectSpec[],
  targetMediaId: string,
  absoluteSeconds: number,
): EffectSpec[] => effects.filter((effect) =>
  effect.targetMediaId === targetMediaId &&
  absoluteSeconds >= effect.startSeconds &&
  absoluteSeconds < effect.endSeconds,
);

export const buildRemotionEffects = (effects: readonly EffectSpec[]): EffectDescriptor<unknown>[] =>
  effects.map(descriptorFor);
