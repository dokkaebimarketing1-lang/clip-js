import React from "react";
import { AbsoluteFill, Img, Sequence } from "remotion";
import { MediaFile } from "@/app/types";
import {cropToClipPath} from "@/app/lib/editor/element-geometry";

const REMOTION_SAFE_FRAME = 0;

interface SequenceItemOptions {
    handleTextChange?: (id: string, text: string) => void;
    fps: number;
    editableTextId?: string | null;
    currentTime?: number;
}

const calculateFrames = (
    display: { from: number; to: number },
    fps: number
) => {
    const from = display.from * fps;
    const to = display.to * fps;
    const durationInFrames = Math.max(1, to - from);
    return { from, durationInFrames };
};

interface ImageSequenceItemProps {
    item: MediaFile;
    options: SequenceItemOptions;
}

export const ImageSequenceItem: React.FC<ImageSequenceItemProps> = ({ item, options }) => {
    const { fps } = options;

    const { from, durationInFrames } = calculateFrames(
        {
            from: item.positionStart,
            to: item.positionEnd
        },
        fps
    );

    return (
        <Sequence
            key={item.id}
            from={from}
            durationInFrames={durationInFrames + REMOTION_SAFE_FRAME}
            style={{ pointerEvents: "none" }}
        >
            <AbsoluteFill
                data-track-item="transition-element"
                className={`designcombo-scene-item id-${item.id} designcombo-scene-item-type-${item.type}`}
                style={{
                    pointerEvents: "auto",
                    top: item.y,
                    left: item.x,
                    width: item.width || "100%",
                    height: item.height || "auto",
                    // transform: item?.transform || "none",
                    opacity:
                        item?.opacity !== undefined
                            ? item.opacity / 100
                            : 1,
                    overflow: "hidden",
                    clipPath: cropToClipPath(item.crop),
                }}
            >
                <div
                    style={{
                        width: item.width || "100%",
                        height: item.height || "auto",
                        position: "relative",
                        overflow: "hidden",
                        pointerEvents: "none",
                    }}
                >
                    <Img
                        style={{
                            pointerEvents: "none",
                            top: 0,
                            left: 0,
                            width: item.width || "100%",
                            height: item.height || "auto",
                            position: "absolute",
                            zIndex: item.zIndex || 0,
                        }}
                        data-id={item.id}
                        src={item.src || ""}
                    />
                </div>
            </AbsoluteFill>
        </Sequence>
    );
};
