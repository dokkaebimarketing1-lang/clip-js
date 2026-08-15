"use client";

import { getFile, useAppDispatch, useAppSelector } from "../../../../store";
import { setMediaFiles } from "../../../../store/slices/projectSlice";
import { storeFile } from "../../../../store";
import { categorizeFile } from "../../../../utils/utils";
import toast from 'react-hot-toast';

export default function AddMedia({ fileId }: { fileId: string }) {
    const { mediaFiles } = useAppSelector((state) => state.projectState);
    const dispatch = useAppDispatch();

    const handleFileChange = async () => {
        if (mediaFiles.some((media) => media.fileId === fileId)) {
            toast('이미 타임라인에 추가된 미디어입니다.');
            return;
        }

        const updatedMedia = [...mediaFiles];

        const file = await getFile(fileId);
        const mediaId = crypto.randomUUID();

        if (fileId) {
            const relevantClips = mediaFiles.filter(clip => clip.type === categorizeFile(file.type));
            const lastEnd = relevantClips.length > 0
                ? Math.max(...relevantClips.map(f => f.positionEnd))
                : 0;

            updatedMedia.push({
                id: mediaId,
                fileName: file.name,
                fileId: fileId,
                startTime: 0,
                endTime: 30,
                src: URL.createObjectURL(file),
                positionStart: lastEnd,
                positionEnd: lastEnd + 30,
                includeInMerge: true,
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
                rotation: 0,
                opacity: 100,
                playbackSpeed: 1,
                volume: 100,
                type: categorizeFile(file.type),
                zIndex: 0,
            });
        }
        dispatch(setMediaFiles(updatedMedia));
        toast.success('미디어를 추가했습니다.');
    };

    return (
        <div>
            <button
                type="button"
                aria-label="미디어 타임라인에 추가"
                className="flex h-8 w-8 items-center justify-center rounded border border-white/10 bg-white/5 text-base font-semibold text-gray-300 transition-colors hover:border-fuchsia-500 hover:bg-fuchsia-500/10 hover:text-fuchsia-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500"
                onClick={handleFileChange}
            >
                <span aria-hidden="true">+</span>
            </button>
        </div>
    );
}
