import type {CSSProperties} from 'react';
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
