"use client";

import Image from "next/image";
import {useEffect, useRef, useState} from "react";
import {extractThumbnail} from "@/app/utils/extractThumbnail";
import {categorizeFile} from "@/app/utils/utils";

type MediaThumbnailProps = {
    readonly file: File;
};

type PreviewState =
    | {readonly status: "idle"}
    | {readonly status: "ready"; readonly url: string}
    | {readonly status: "failed"};

const Placeholder = ({kind}: {readonly kind: "audio" | "media"}) => (
    <div className="flex h-full w-full items-center justify-center text-gray-500" aria-hidden="true">
        {kind === "audio" ? (
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 18V5l10-2v13M9 9l10-2M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm10-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
            </svg>
        ) : (
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="m3 16 4-4a3 3 0 0 1 4 0l1 1 2-2a3 3 0 0 1 4 0l3 3M8.5 8.5h.01M5 21h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2Z" />
            </svg>
        )}
    </div>
);

export function MediaThumbnail({file}: MediaThumbnailProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [preview, setPreview] = useState<PreviewState>({status: "idle"});
    const mediaType = categorizeFile(file.type);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        if (!("IntersectionObserver" in window)) {
            setIsVisible(true);
            return;
        }

        const observer = new IntersectionObserver((entries) => {
            const entry = entries[0];
            if (entry?.isIntersecting) {
                setIsVisible(true);
                observer.disconnect();
            }
        });

        observer.observe(container);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!isVisible || (mediaType !== "image" && mediaType !== "video")) return;

        let disposed = false;
        let previewUrl: string | undefined;
        const controller = new AbortController();

        const usePreview = (previewFile: File) => {
            const objectUrl = URL.createObjectURL(previewFile);
            if (disposed) {
                URL.revokeObjectURL(objectUrl);
                return;
            }

            previewUrl = objectUrl;
            setPreview({status: "ready", url: objectUrl});
        };

        if (mediaType === "image") {
            usePreview(file);
        } else {
            void extractThumbnail(file, controller.signal).then(usePreview, () => {
                if (!disposed) setPreview({status: "failed"});
            });
        }

        return () => {
            disposed = true;
            controller.abort();
            if (previewUrl) URL.revokeObjectURL(previewUrl);
        };
    }, [file, isVisible, mediaType]);

    const handlePreviewError = () => {
        if (preview.status === "ready") URL.revokeObjectURL(preview.url);
        setPreview({status: "failed"});
    };

    return (
        <div
            ref={containerRef}
            className="relative h-12 w-20 flex-shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/30"
        >
            {preview.status === "ready" ? (
                <Image
                    src={preview.url}
                    alt=""
                    fill
                    sizes="5rem"
                    unoptimized
                    className="object-cover"
                    onError={handlePreviewError}
                />
            ) : (
                <Placeholder kind={mediaType === "audio" ? "audio" : "media"} />
            )}
        </div>
    );
}
