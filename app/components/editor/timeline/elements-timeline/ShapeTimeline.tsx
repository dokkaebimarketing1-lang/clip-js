import Moveable, {type OnDrag, type OnResize} from 'react-moveable';
import {useAppSelector} from '@/app/store';
import {setShapes} from '@/app/store/slices/projectSlice';
import type {ShapeElement} from '@/app/types';
import {
  applyDragPosition,
  applyResizeWidth,
  applyWestResizePosition,
  calculateEastResize,
  calculateTimelineDrag,
  calculateWestResize,
  useThrottledTimelineElementUpdate,
  useTimelineElementRefs,
  useTimelineElementSelection,
} from './timeline-element-logic';

const LABELS: Record<ShapeElement['type'], string> = {
  rect: '사각형',
  circle: '원',
  line: '선',
};

export default function ShapeTimeline() {
  const {activeElement, activeElementIndex, shapes, timelineZoom} = useAppSelector((state) => state.projectState);
  const updateShape = useThrottledTimelineElementUpdate(shapes, setShapes);
  const selectShape = useTimelineElementSelection('shape', shapes);
  const {getTarget, setMoveableRef, setTargetRef} = useTimelineElementRefs(shapes, timelineZoom);

  const handleDrag = (shape: ShapeElement, target: HTMLElement, left: number): void => {
    const drag = calculateTimelineDrag(shape.positionStart, left, timelineZoom);
    updateShape(shape.id, {
      positionStart: drag.positionStart,
      positionEnd: drag.positionDelta + shape.positionEnd,
    });
    applyDragPosition(target, drag.constrainedLeft);
  };

  const handleEastResize = (shape: ShapeElement, width: number): void => {
    updateShape(shape.id, {positionEnd: calculateEastResize(shape.positionStart, width, timelineZoom).positionEnd});
  };

  const handleWestResize = (shape: ShapeElement, target: HTMLElement, width: number): void => {
    const resize = calculateWestResize(shape.positionStart, shape.positionEnd, width, timelineZoom);
    updateShape(shape.id, {positionStart: resize.positionStart});
    applyWestResizePosition(target, resize);
  };

  return (
    <div>
      {shapes.map((shape) => {
        const selected = activeElement === 'shape' && shapes[activeElementIndex]?.id === shape.id;
        return (
          <div key={shape.id}>
            <div
              ref={(element) => setTargetRef(shape.id, element)}
              onClick={() => selectShape(shape.id)}
              className={`absolute top-2 flex h-12 cursor-pointer items-center justify-center rounded-md border border-gray-500/50 bg-[#27272A] px-3 text-sm text-white ${selected ? 'border-fuchsia-400 bg-[#3F3F46]' : ''}`}
              style={{left: shape.positionStart * timelineZoom, width: (shape.positionEnd - shape.positionStart) * timelineZoom, zIndex: shape.zIndex}}
            >
              <span className="truncate">{LABELS[shape.type]}</span>
            </div>
            <Moveable
              ref={(instance) => setMoveableRef(shape.id, instance)}
              target={getTarget(shape.id)}
              container={null}
              renderDirections={selected ? ['w', 'e'] : []}
              draggable
              resizable
              rotatable={false}
              throttleDrag={0}
              throttleResize={0}
              onDrag={({target, left}: OnDrag) => {
                selectShape(shape.id);
                handleDrag(shape, target as HTMLElement, left);
              }}
              onResize={({target, width, delta, direction}: OnResize) => {
                selectShape(shape.id);
                const resizeTarget = target as HTMLElement;
                applyResizeWidth(resizeTarget, width, delta[0]);
                if (direction[0] === 1) handleEastResize(shape, width);
                if (direction[0] === -1) handleWestResize(shape, resizeTarget, width);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
