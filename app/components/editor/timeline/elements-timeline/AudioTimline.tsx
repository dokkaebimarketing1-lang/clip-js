import React from "react";
import Moveable, { OnDrag, OnResize } from "react-moveable";
import { useAppSelector } from "@/app/store";
import { setMediaFiles } from "@/app/store/slices/projectSlice";
import Image from "next/image";
import type { MediaFile } from "@/app/types";
import {
    applyDragPosition,
    applyResizeWidth,
    applyWestResizePosition,
    calculateEastResize,
    calculateTimelineDrag,
    calculateTrimmedStartTime,
    calculateWestResize,
    useThrottledTimelineElementUpdate,
    useTimelineElementRefs,
    useTimelineElementSelection,
} from "./timeline-element-logic";

export default function AudioTimeline() {
    const { mediaFiles, textElements, activeElement, activeElementIndex, timelineZoom } = useAppSelector((state) => state.projectState);
    const onUpdateMedia = useThrottledTimelineElementUpdate(mediaFiles, setMediaFiles);
    const selectElement = useTimelineElementSelection('media', mediaFiles);
    const { getTarget, setMoveableRef, setTargetRef } = useTimelineElementRefs(mediaFiles, timelineZoom);

    const handleDrag = (clip: MediaFile, target: HTMLElement, left: number) => {
        const drag = calculateTimelineDrag(clip.positionStart, left, timelineZoom);
        onUpdateMedia(clip.id, {
            positionStart: drag.positionStart,
            positionEnd: drag.positionDelta + clip.positionEnd,
            endTime: Math.max(drag.positionDelta + clip.endTime, clip.endTime)
        })

        applyDragPosition(target, drag.constrainedLeft);
    };

    const handleRightResize = (clip: MediaFile, target: HTMLElement, width: number) => {
        const resize = calculateEastResize(clip.positionStart, width, timelineZoom);

        onUpdateMedia(clip.id, {
            positionEnd: resize.positionEnd,
            endTime: Math.max(resize.positionEnd, clip.endTime)
        })
    };

    const handleLeftResize = (clip: MediaFile, target: HTMLElement, width: number) => {
        const resize = calculateWestResize(clip.positionStart, clip.positionEnd, width, timelineZoom);

        onUpdateMedia(clip.id, {
            positionStart: resize.positionStart,
            startTime: calculateTrimmedStartTime(clip.startTime, resize.trimDelta),
        })

        applyWestResizePosition(target, resize);
    };

    return (
        <div >
            {mediaFiles
                .filter(clip => clip.type === 'audio')
                .map((clip) => (
                    <div key={clip.id} className="bg-green-500">
                        <div
                            key={clip.id}
                            ref={(el: HTMLDivElement | null) => setTargetRef(clip.id, el)}
                            onClick={() => selectElement(clip.id)}
                            className={`absolute border border-gray-500 border-opacity-50 rounded-md top-2 h-12 rounded bg-[#27272A] text-white text-sm flex items-center justify-center cursor-pointer ${activeElement === 'media' && mediaFiles[activeElementIndex].id === clip.id ? 'bg-[#3F3F46] border-blue-500' : ''}`}
                            style={{
                                left: `${clip.positionStart * timelineZoom}px`,
                                width: `${(clip.positionEnd / clip.playbackSpeed - clip.positionStart / clip.playbackSpeed) * timelineZoom}px`,
                                zIndex: clip.zIndex,
                            }}
                        >
                            {/* <MoveableTimeline /> */}
                            <Image
                                alt="Audio"
                                className="h-7 w-7 min-w-6 mr-2 flex-shrink-0"
                                height={30}
                                width={30}
                                src="https://www.svgrepo.com/show/532708/music.svg"
                            />
                            <span className="truncate text-x">{clip.fileName}</span>

                        </div>
                        <Moveable
                            ref={(el: Moveable | null) => setMoveableRef(clip.id, el)}
                            target={getTarget(clip.id)}
                            container={null}
                            renderDirections={activeElement === 'media' && mediaFiles[activeElementIndex].id === clip.id ? ['w', 'e'] : []}
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
                                    handleRightResize(clip, resizeTarget, width);
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
