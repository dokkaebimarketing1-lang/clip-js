'use client';

import {useAppDispatch, useAppSelector} from '@/app/store';
import {setShapes} from '@/app/store/slices/projectSlice';
import type {ShapeElement} from '@/app/types';

const inputClassName = 'w-full rounded border border-white/10 bg-darkSurfacePrimary p-2 text-white shadow-md focus:outline-none focus:ring-2 focus:ring-fuchsia-400';

export default function ShapeProperties() {
  const dispatch = useAppDispatch();
  const {activeElementIndex, shapes} = useAppSelector((state) => state.projectState);
  const shape = shapes[activeElementIndex];

  if (!shape) return null;

  const updateShape = (updates: Partial<ShapeElement>): void => {
    dispatch(setShapes(shapes.map((item) => item.id === shape.id ? {...item, ...updates} : item)));
  };

  const updateRotation = (rotation: number): void => {
    updateShape(shape.transform
      ? {transform: {...shape.transform, rotation}}
      : {rotation});
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <label className="space-y-1 text-xs text-gray-300">
          <span className="block">너비</span>
          <input className={inputClassName} type="number" min={1} value={shape.width} onChange={(event) => updateShape({width: Number(event.target.value)})} />
        </label>
        <label className="space-y-1 text-xs text-gray-300">
          <span className="block">높이</span>
          <input className={inputClassName} type="number" min={1} value={shape.height} onChange={(event) => updateShape({height: Number(event.target.value)})} />
        </label>
        <label className="space-y-1 text-xs text-gray-300">
          <span className="block">X 위치</span>
          <input className={inputClassName} type="number" value={shape.x} onChange={(event) => updateShape({x: Number(event.target.value)})} />
        </label>
        <label className="space-y-1 text-xs text-gray-300">
          <span className="block">Y 위치</span>
          <input className={inputClassName} type="number" value={shape.y} onChange={(event) => updateShape({y: Number(event.target.value)})} />
        </label>
        <label className="space-y-1 text-xs text-gray-300">
          <span className="block">색상</span>
          <input className="h-10 w-full rounded border border-white/10 bg-darkSurfacePrimary" type="color" value={shape.color} onChange={(event) => updateShape({color: event.target.value})} />
        </label>
        <label className="space-y-1 text-xs text-gray-300">
          <span className="block">회전</span>
          <input className={inputClassName} type="number" value={shape.transform?.rotation ?? shape.rotation ?? 0} onChange={(event) => updateRotation(Number(event.target.value))} />
        </label>
      </div>
      <label className="block space-y-2 text-xs text-gray-300">
        <span className="flex justify-between"><span>불투명도</span><span>{shape.opacity}%</span></span>
        <input className="w-full accent-fuchsia-500" type="range" min={0} max={100} step={1} value={shape.opacity} onChange={(event) => updateShape({opacity: Number(event.target.value)})} />
      </label>
    </div>
  );
}
