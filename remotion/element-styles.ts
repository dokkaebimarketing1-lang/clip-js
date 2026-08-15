import type {CSSProperties} from 'react';
import {interpolate} from 'remotion';
import type {MediaFile, TextElement} from '../app/types';
import {cropToClipPath, elementTransformCss} from '../app/lib/editor/element-geometry';

export type CompositionSize = {
  readonly width: number;
  readonly height: number;
};

export const mediaTransformCss = (media: MediaFile, composition: CompositionSize): string =>
  elementTransformCss(media.transform, composition) ?? `rotate(${media.rotation ?? 0}deg)`;

export const mediaVisualStyle = (media: MediaFile, composition: CompositionSize): CSSProperties => ({
  position: 'absolute',
  left: media.x ?? 0,
  top: media.y ?? 0,
  width: media.width ?? '100%',
  height: media.height ?? '100%',
  opacity: media.opacity === undefined ? 1 : media.opacity / 100,
  zIndex: media.zIndex,
  transform: mediaTransformCss(media, composition),
  transformOrigin: 'center center',
  clipPath: cropToClipPath(media.crop),
});

export const textVisualStyle = (item: TextElement, composition: CompositionSize): CSSProperties => ({
  position: 'absolute',
  left: item.x,
  top: item.y,
  width: item.width ?? 1200,
  zIndex: item.zIndex,
  fontFamily: item.font ?? 'Arial',
  fontSize: item.fontSize ?? 64,
  color: item.color ?? '#fff',
  backgroundColor: item.backgroundColor ?? 'transparent',
  textAlign: item.align ?? 'center',
  opacity: (item.opacity ?? 100) / 100,
  whiteSpace: 'pre-wrap',
  transform: elementTransformCss(item.transform, composition),
  transformOrigin: 'center center',
});

const pixel = (value: number): string => `${Number(value.toFixed(3))}px`;

const animatedTransform = (item: TextElement, composition: CompositionSize, effect: string): string => {
  const baseTransform = elementTransformCss(item.transform, composition);
  return baseTransform ? `${baseTransform} ${effect}` : effect;
};

export const textAnimationStyle = (
  item: TextElement,
  frame: number,
  fps: number,
  composition: CompositionSize,
): CSSProperties => {
  const animation = item.animation ?? 'none';
  const progress = interpolate(frame, [0, fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  switch (animation) {
    case 'none':
      return {};
    case 'slide-in':
      return frame >= fps ? {} : {
        transform: animatedTransform(item, composition, `translateX(${pixel(-composition.width * (1 - progress))})`),
      };
    case 'zoom':
      return frame >= fps ? {} : {
        transform: animatedTransform(item, composition, `scale(${Number((0.5 + progress * 0.5).toFixed(3))})`),
      };
    case 'bounce':
      return frame >= fps ? {} : {
        transform: animatedTransform(item, composition, `translateY(${pixel(-50 * Math.sin(progress * Math.PI * 2))})`),
      };
    case 'typewriter':
      return frame >= fps ? {} : {
        clipPath: `inset(0 ${Number(((1 - progress) * 100).toFixed(3))}% 0 0)`,
      };
    case 'shake': {
      const elapsedSeconds = frame / fps;
      const offsetX = 4 * Math.sin(elapsedSeconds * Math.PI * 16);
      const offsetY = 2 * Math.sin(elapsedSeconds * Math.PI * 22);
      return {
        transform: animatedTransform(item, composition, `translate(${pixel(offsetX)}, ${pixel(offsetY)})`),
      };
    }
    case 'glow': {
      const pulse = (Math.sin((frame / fps) * Math.PI * 2) + 1) / 2;
      const nearRadius = 6 + pulse * 6;
      const farRadius = 12 + pulse * 12;
      return {
        textShadow: `0 0 ${pixel(nearRadius)} currentColor, 0 0 ${pixel(farRadius)} currentColor`,
      };
    }
  }

  const exhaustiveAnimation: never = animation;
  return exhaustiveAnimation;
};
