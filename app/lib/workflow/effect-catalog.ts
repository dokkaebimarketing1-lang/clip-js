import type {EffectType} from './schema';

export const EFFECT_CATALOG: ReadonlyArray<{
  type: EffectType;
  label: string;
  source: 'official-remotion';
}> = [
  {type: 'blur', label: 'Blur', source: 'official-remotion'},
  {type: 'chromatic-aberration', label: 'Chromatic Aberration', source: 'official-remotion'},
  {type: 'vignette', label: 'Vignette', source: 'official-remotion'},
  {type: 'noise', label: 'Film Noise', source: 'official-remotion'},
  {type: 'pixelate', label: 'Pixelate', source: 'official-remotion'},
  {type: 'glow', label: 'Glow', source: 'official-remotion'},
];
