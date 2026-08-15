import React from "react";
import Moveable, { OnDrag, OnResize } from "react-moveable";
import { useAppSelector } from "@/app/store";
import { setTextElements } from "@/app/store/slices/projectSlice";
import Image from "next/image";
import type { TextElement } from "@/app/types";
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
} from "./timeline-element-logic";

export default function TextTimeline() {
    const { textElements, activeElement, activeElementIndex, timelineZoom } = useAppSelector((state) => state.projectState);
    const onUpdateText = useThrottledTimelineElementUpdate(textElements, setTextElements);
    const selectElement = useTimelineElementSelection('text', textElements);
    const { getTarget, setMoveableRef, setTargetRef } = useTimelineElementRefs(textElements, timelineZoom);

    const handleDrag = (clip: TextElement, target: HTMLElement, left: number) => {
        const drag = calculateTimelineDrag(clip.positionStart, left, timelineZoom);
        onUpdateText(clip.id, {
            positionStart: drag.positionStart,
            positionEnd: drag.positionDelta + clip.positionEnd,
        })

        applyDragPosition(target, drag.constrainedLeft);
    };

    const handleResize = (clip: TextElement, target: HTMLElement, width: number) => {
        const resize = calculateEastResize(clip.positionStart, width, timelineZoom);

        onUpdateText(clip.id, {
            positionEnd: resize.positionEnd,
        })
    };
    const handleLeftResize = (clip: TextElement, target: HTMLElement, width: number) => {
        const resize = calculateWestResize(clip.positionStart, clip.positionEnd, width, timelineZoom);

        onUpdateText(clip.id, {
            positionStart: resize.positionStart,
        })

        applyWestResizePosition(target, resize);
    };

    return (
        <div >
            {textElements.map((clip, index) => (
                <div key={clip.id} className="bg-green-500">
                    <div
                        key={clip.id}
                        ref={(el: HTMLDivElement | null) => setTargetRef(clip.id, el)}
                        onClick={() => selectElement(clip.id)}
                        className={`absolute border border-gray-500 border-opacity-50 rounded-md top-2 h-12 rounded bg-[#27272A] text-white text-sm flex items-center justify-center cursor-pointer ${activeElement === 'text' && textElements[activeElementIndex].id === clip.id ? 'bg-[#3F3F46] border-blue-500' : ''}`}
                        style={{
                            left: `${clip.positionStart * timelineZoom}px`,
                            width: `${(clip.positionEnd - clip.positionStart) * timelineZoom}px`,
                            zIndex: clip.zIndex,
                        }}
                    >
                        {/* <MoveableTimeline /> */}
                        <Image
                            alt="Text"
                            className="h-7 w-7 min-w-6 mr-2 flex-shrink-0"
                            height={30}
                            width={30}
                            src="https://www.svgrepo.com/show/535686/text.svg"
                        />
                        <span className="truncate text-x">{clip.text}</span>

                    </div>

                    <Moveable
                        ref={(el: Moveable | null) => setMoveableRef(clip.id, el)}
                        target={getTarget(clip.id)}
                        container={null}
                        renderDirections={activeElement === 'text' && textElements[activeElementIndex] && textElements[activeElementIndex].id === clip.id ? ['w', 'e'] : []}
                        draggable={true}
                        throttleDrag={0}
                        rotatable={false}
                        onDragStart={({ target, clientX, clientY }) => {
                        }}
                        onDrag={({
                            target,
                            beforeDelta, beforeDist,
                            left,
                            right,
                            delta, dist,
                            transform,
                        }: OnDrag) => {
                            selectElement(clip.id)
                            handleDrag(clip, target as HTMLElement, left);
                        }}
                        onDragEnd={({ target, isDrag, clientX, clientY }) => {
                        }}

                        /* resizable*/
                        resizable={true}
                        throttleResize={0}
                        onResizeStart={({ target, clientX, clientY }) => {
                        }}
                        onResize={({
                            target, width,
                            delta, direction,
                        }: OnResize) => {
                            if (direction[0] === 1) {
                                selectElement(clip.id)
                                const resizeTarget = target as HTMLElement;
                                applyResizeWidth(resizeTarget, width, delta[0]);
                                handleResize(clip, resizeTarget, width);

                            }
                            else if (direction[0] === -1) {
                                selectElement(clip.id)
                                const resizeTarget = target as HTMLElement;
                                applyResizeWidth(resizeTarget, width, delta[0]);
                                handleLeftResize(clip, resizeTarget, width);
                            }
                        }}
                        onResizeEnd={({ target, isDrag, clientX, clientY }) => {
                        }}

                    />
                </div>

            ))}
        </div>
    );
}
