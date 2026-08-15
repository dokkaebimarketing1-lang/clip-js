import type {ElementTransform, NormalizedCrop} from '@/app/types';

type CompositionSize = {
  readonly width: number;
  readonly height: number;
};

const formatNumber = (value: number): string => String(Number(value.toFixed(6)));

export const elementTransformCss = (
  transform: ElementTransform | undefined,
  composition: CompositionSize,
): string | undefined => transform
  ? `translate(${formatNumber(transform.x * composition.width)}px, ${formatNumber(transform.y * composition.height)}px) rotate(${formatNumber(transform.rotation)}deg) scale(${formatNumber(transform.scale)})`
  : undefined;

export const cropToClipPath = (crop: NormalizedCrop | undefined): string | undefined => {
  if (!crop) return undefined;
  const right = 1 - crop.left - crop.width;
  const bottom = 1 - crop.top - crop.height;
  return `inset(${formatNumber(crop.top * 100)}% ${formatNumber(right * 100)}% ${formatNumber(bottom * 100)}% ${formatNumber(crop.left * 100)}%)`;
};

export const cropFromInsetClipStyles = (styles: readonly string[]): NormalizedCrop | undefined => {
  if (styles.length !== 4) return undefined;
  const parsed = styles.map((style) => Number.parseFloat(style) / 100);
  if (parsed.some((value) => !Number.isFinite(value))) return undefined;
  const values = parsed.map((value) => Number(Math.min(1, Math.max(0, value)).toFixed(6)));
  const [top, right, bottom, left] = values;
  if (top === undefined || right === undefined || bottom === undefined || left === undefined) return undefined;
  const width = Number((1 - left - right).toFixed(6));
  const height = Number((1 - top - bottom).toFixed(6));
  if (width <= 0 || height <= 0) return undefined;
  return {left, top, width, height};
};
