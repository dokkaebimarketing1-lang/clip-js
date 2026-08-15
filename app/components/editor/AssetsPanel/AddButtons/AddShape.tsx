'use client';

import {useAppDispatch, useAppSelector} from '@/app/store';
import {setShapes} from '@/app/store/slices/projectSlice';
import type {ShapeElement} from '@/app/types';
import toast from 'react-hot-toast';

const SHAPE_OPTIONS = [
  {type: 'rect', label: '사각형', iconClassName: 'h-5 w-7 rounded-sm'},
  {type: 'circle', label: '원', iconClassName: 'h-5 w-5 rounded-full'},
  {type: 'line', label: '선', iconClassName: 'h-0.5 w-7 rounded-full'},
] as const satisfies readonly {type: ShapeElement['type']; label: string; iconClassName: string}[];

const SHAPE_DIMENSIONS: Record<ShapeElement['type'], Pick<ShapeElement, 'width' | 'height'>> = {
  rect: {width: 360, height: 220},
  circle: {width: 240, height: 240},
  line: {width: 360, height: 6},
};

export default function AddShape() {
  const dispatch = useAppDispatch();
  const shapes = useAppSelector((state) => state.projectState.shapes);

  const addShape = (type: ShapeElement['type']): void => {
    const positionStart = shapes.reduce((latest, shape) => Math.max(latest, shape.positionEnd), 0);
    const zIndex = shapes.reduce((highest, shape) => Math.max(highest, shape.zIndex), 0) + 1;
    const shape: ShapeElement = {
      id: crypto.randomUUID(),
      type,
      positionStart,
      positionEnd: positionStart + 10,
      x: 780,
      y: 430,
      ...SHAPE_DIMENSIONS[type],
      color: '#d946ef',
      opacity: 100,
      zIndex,
      rotation: 0,
    };
    dispatch(setShapes([...shapes, shape]));
    toast.success('도형을 추가했습니다.');
  };

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.035] p-3">
      <p className="text-xs font-black text-gray-200">도형 추가</p>
      <div className="grid grid-cols-3 gap-2">
        {SHAPE_OPTIONS.map((option) => (
          <button
            key={option.type}
            type="button"
            onClick={() => addShape(option.type)}
            className="flex min-h-16 flex-col items-center justify-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2 py-3 text-[11px] font-bold text-gray-300 transition-colors hover:border-fuchsia-400/40 hover:bg-fuchsia-400/[0.08] hover:text-fuchsia-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
          >
            <span
              aria-hidden="true"
              className={`${option.iconClassName} border border-fuchsia-300 bg-fuchsia-400/25`}
            />
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
