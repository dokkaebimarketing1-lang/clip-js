import { useAppSelector } from "@/app/store";
import { setMarkerTrack, setTextElements, setMediaFiles, setTimelineZoom, setCurrentTime, setIsPlaying, setActiveElement } from "@/app/store/slices/projectSlice";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useDispatch } from "react-redux";
import Image from "next/image";
import Header from "./Header";
import VideoTimeline from "./elements-timeline/VideoTimeline";
import ImageTimeline from "./elements-timeline/ImageTimeline";
import AudioTimeline from "./elements-timeline/AudioTimline";
import TextTimeline from "./elements-timeline/TextTimeline";
import { throttle } from 'lodash';
import GlobalKeyHandlerProps from "../../../components/editor/keys/GlobalKeyHandlerProps";
import toast from "react-hot-toast";
export const Timeline = () => {
    const { currentTime, timelineZoom, enableMarkerTracking, activeElement, activeElementIndex, mediaFiles, textElements, duration, isPlaying } = useAppSelector((state) => state.projectState);
    const dispatch = useDispatch();
    const timelineRef = useRef<HTMLDivElement>(null)

    const throttledZoom = useMemo(() =>
        throttle((value: number) => {
            dispatch(setTimelineZoom(value));
        }, 100),
        [dispatch]
    );

    const handleSplit = () => {
        let element = null;
        let elements = null;
        let setElements = null;

        if (!activeElement) {
            toast.error('선택한 요소가 없습니다.');
            return;
        }

        if (activeElement === 'media') {
            elements = [...mediaFiles];
            element = elements[activeElementIndex];
            setElements = setMediaFiles;

            if (!element) {
                toast.error('선택한 요소가 없습니다.');
                return;
            }

            const { positionStart, positionEnd } = element;

            if (currentTime <= positionStart || currentTime >= positionEnd) {
                toast.error('재생 위치가 선택한 요소의 범위를 벗어났습니다.');
                return;
            }

            const positionDuration = positionEnd - positionStart;

            // Media logic (uses startTime/endTime for trimming)
            const { startTime, endTime } = element;
            const sourceDuration = endTime - startTime;
            const ratio = (currentTime - positionStart) / positionDuration;
            const splitSourceOffset = startTime + ratio * sourceDuration;

            const firstPart = {
                ...element,
                id: crypto.randomUUID(),
                positionStart,
                positionEnd: currentTime,
                startTime,
                endTime: splitSourceOffset
            };

            const secondPart = {
                ...element,
                id: crypto.randomUUID(),
                positionStart: currentTime,
                positionEnd,
                startTime: splitSourceOffset,
                endTime
            };

            elements.splice(activeElementIndex, 1, firstPart, secondPart);
        } else if (activeElement === 'text') {
            elements = [...textElements];
            element = elements[activeElementIndex];
            setElements = setTextElements;

            if (!element) {
                toast.error('선택한 요소가 없습니다.');
                return;
            }

            const { positionStart, positionEnd } = element;

            if (currentTime <= positionStart || currentTime >= positionEnd) {
                toast.error('재생 위치가 선택한 요소 밖에 있습니다.');
                return;
            }

            const firstPart = {
                ...element,
                id: crypto.randomUUID(),
                positionStart,
                positionEnd: currentTime,
            };

            const secondPart = {
                ...element,
                id: crypto.randomUUID(),
                positionStart: currentTime,
                positionEnd,
            };

            elements.splice(activeElementIndex, 1, firstPart, secondPart);
        }

        if (elements && setElements) {
            dispatch(setElements(elements as any));
            dispatch(setActiveElement(null));
            toast.success('요소를 분할했습니다.');
        }
    };

    const handleDuplicate = () => {
        let element = null;
        let elements = null;
        let setElements = null;

        if (activeElement === 'media') {
            elements = [...mediaFiles];
            element = elements[activeElementIndex];
            setElements = setMediaFiles;
        } else if (activeElement === 'text') {
            elements = [...textElements];
            element = elements[activeElementIndex];
            setElements = setTextElements;
        }

        if (!element) {
            toast.error('선택한 요소가 없습니다.');
            return;
        }

        const duplicatedElement = {
            ...element,
            id: crypto.randomUUID(),
        };

        if (elements) {
            elements.splice(activeElementIndex + 1, 0, duplicatedElement as any);
        }

        if (elements && setElements) {
            dispatch(setElements(elements as any));
            dispatch(setActiveElement(null));
            toast.success('요소를 복제했습니다.');
        }
    };

    const handleDelete = () => {
        // @ts-ignore
        let element = null;
        let elements = null;
        let setElements = null;

        if (activeElement === 'media') {
            elements = [...mediaFiles];
            element = elements[activeElementIndex];
            setElements = setMediaFiles;
        } else if (activeElement === 'text') {
            elements = [...textElements];
            element = elements[activeElementIndex];
            setElements = setTextElements;
        }

        if (!element) {
            toast.error('선택한 요소가 없습니다.');
            return;
        }

        if (elements) {
            // @ts-ignore
            elements = elements.filter(ele => ele.id !== element.id)
        }

        if (elements && setElements) {
            dispatch(setElements(elements as any));
            dispatch(setActiveElement(null));
            toast.success('요소를 삭제했습니다.');
        }
    };


    const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!timelineRef.current) return;

        dispatch(setIsPlaying(false));
        const rect = timelineRef.current.getBoundingClientRect();

        const scrollOffset = timelineRef.current.scrollLeft;
        const offsetX = e.clientX - rect.left + scrollOffset;

        const seconds = offsetX / timelineZoom;
        const clampedTime = Math.max(0, Math.min(duration, seconds));

        dispatch(setCurrentTime(clampedTime));
    };

    return (
        <div className="flex w-full flex-col gap-2">
            <div className="flex w-full flex-row items-center justify-between gap-3">
                <div className="flex shrink-0 flex-row items-center gap-2">
                    {/* Track Marker */}
                    <button
                        onClick={() => dispatch(setMarkerTrack(!enableMarkerTracking))}
                        className="flex h-7 items-center justify-center gap-1 rounded border border-white/10 bg-white/5 px-2 text-[11px] font-medium text-gray-200 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
                    >
                        {enableMarkerTracking ? <Image
                            alt="cut"
                            className="h-auto w-auto max-w-[14px] max-h-[14px] invert"
                            height={30}
                            width={30}
                            src="https://www.svgrepo.com/show/447546/yes-alt.svg"
                        /> : <Image
                            alt="cut"
                            className="h-auto w-auto max-w-[14px] max-h-[14px] invert"
                            height={30}
                            width={30}
                            src="https://www.svgrepo.com/show/447315/dismiss.svg"
                        />}
                        <span className="ml-1">마커 추적 <span className="text-xs">(T)</span></span>
                    </button>
                    {/* Split */}
                    <button
                        onClick={handleSplit}
                        className="flex h-7 items-center justify-center gap-1 rounded border border-white/10 bg-white/5 px-2 text-[11px] font-medium text-gray-200 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
                    >
                        <Image
                            alt="cut"
                            className="h-auto w-auto max-w-[14px] max-h-[14px] invert"
                            height={30}
                            width={30}
                            src="https://www.svgrepo.com/show/509075/cut.svg"
                        />
                        <span className="ml-1">분할 <span className="text-xs">(S)</span></span>
                    </button>
                    {/* Duplicate */}
                    <button
                        onClick={handleDuplicate}
                        className="flex h-7 items-center justify-center gap-1 rounded border border-white/10 bg-white/5 px-2 text-[11px] font-medium text-gray-200 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
                    >
                        <Image
                            alt="cut"
                            className="h-auto w-auto max-w-[14px] max-h-[14px] invert"
                            height={30}
                            width={30}
                            src="https://www.svgrepo.com/show/521623/duplicate.svg"
                        />
                        <span className="ml-1">복제 <span className="text-xs">(D)</span></span>
                    </button>
                    {/* Delete */}
                    <button
                        onClick={handleDelete}
                        className="flex h-7 items-center justify-center gap-1 rounded border border-white/10 bg-white/5 px-2 text-[11px] font-medium text-gray-200 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
                    >
                        <Image
                            alt="Delete"
                            className="h-auto w-auto max-w-[14px] max-h-[14px] invert"
                            height={30}
                            width={30}
                            src="https://www.svgrepo.com/show/511788/delete-1487.svg"
                        />
                        <span className="ml-1">삭제 <span className="text-xs">(Del)</span></span>
                    </button>
                </div>

                {/* Timeline Zoom */}
                <div className="mr-2 flex shrink-0 flex-row items-center gap-1.5">
                    <label className="whitespace-nowrap text-[11px] font-semibold text-gray-300">확대/축소</label>
                    <span className="text-white text-lg">-</span>
                    <input
                        type="range"
                        min={30}
                        max={120}
                        step="1"
                        value={timelineZoom}
                        onChange={(e) => throttledZoom(Number(e.target.value))}
                        className="w-[72px] rounded border border-white/10 bg-darkSurfacePrimary text-white shadow-md focus:outline-none focus:ring-2 focus:ring-fuchsia-400 2xl:w-[100px]"
                    />
                    <span className="text-white text-lg">+</span>
                </div>
            </div>

            <div
                className="relative overflow-x-auto w-full border-t border-gray-800 bg-[#1E1D21] z-10"
                ref={timelineRef}
                onClick={handleClick}
            >
                {/* Timeline Header */}
                <Header />

                <div className="bg-[#1E1D21]"

                    style={{
                        width: "100%", /* or whatever width your timeline requires */
                    }}
                >
                    {/* Timeline cursor */}
                    <div
                        className="absolute top-0 bottom-0 w-[2px] bg-red-500 z-50"
                        style={{
                            left: `${currentTime * timelineZoom}px`,
                        }}
                    />
                    {/* Timeline elements */}
                    <div className="w-full">

                        <div className="relative h-8 z-10">
                            <VideoTimeline />
                        </div>

                        <div className="relative h-8 z-10">
                            <AudioTimeline />
                        </div>

                        <div className="relative h-8 z-10">
                            <ImageTimeline />
                        </div>

                        <div className="relative h-8 z-10">
                            <TextTimeline />
                        </div>

                    </div>
                </div>
            </div >
            <GlobalKeyHandlerProps handleDuplicate={handleDuplicate} handleSplit={handleSplit} handleDelete={handleDelete} />
        </div>

    );
};

export default memo(Timeline)
