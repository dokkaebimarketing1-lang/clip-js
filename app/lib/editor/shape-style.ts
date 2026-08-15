import type {CSSProperties} from 'react';
import type {ShapeElement} from '@/app/types';
import {elementTransformCss} from './element-geometry';

type CompositionSize = {
  readonly width: number;
  readonly height: number;
};

const SHAPE_BORDER_RADIUS: Record<ShapeElement['type'], CSSProperties['borderRadius']> = {
  rect: 0,
  circle: '50%',
  line: 9999,
};

export const shapeVisualStyle = (
  shape: ShapeElement,
  composition: CompositionSize,
): CSSProperties => ({
  position: 'absolute',
  left: shape.x,
  top: shape.y,
  width: shape.width,
  height: shape.height,
  backgroundColor: shape.color,
  borderRadius: SHAPE_BORDER_RADIUS[shape.type],
  opacity: shape.opacity / 100,
  zIndex: shape.zIndex,
  transform: elementTransformCss(shape.transform, composition) ?? `rotate(${shape.rotation ?? 0}deg)`,
  transformOrigin: 'center center',
});
