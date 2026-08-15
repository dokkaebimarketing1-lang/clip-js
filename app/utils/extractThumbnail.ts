const THUMBNAIL_POSITION = 0.25;
const THUMBNAIL_MAX_WIDTH = 320;

class ThumbnailExtractionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ThumbnailExtractionError";
    }
}

export const extractThumbnail = (file: File, signal: AbortSignal): Promise<File> => {
    return new Promise((resolve, reject) => {
        const video = document.createElement("video");
        const sourceUrl = URL.createObjectURL(file);

        const cleanup = () => {
            video.removeEventListener("loadedmetadata", handleLoadedMetadata);
            video.removeEventListener("seeked", handleSeeked);
            video.removeEventListener("error", handleError);
            signal.removeEventListener("abort", handleAbort);
            video.removeAttribute("src");
            video.load();
            URL.revokeObjectURL(sourceUrl);
        };

        const fail = (message: string) => {
            cleanup();
            reject(new ThumbnailExtractionError(message));
        };

        function handleLoadedMetadata() {
            if (!Number.isFinite(video.duration) || video.duration <= 0) {
                fail("Video duration is unavailable");
                return;
            }

            video.currentTime = video.duration * THUMBNAIL_POSITION;
        }

        function handleSeeked() {
            if (video.videoWidth <= 0 || video.videoHeight <= 0) {
                fail("Video dimensions are unavailable");
                return;
            }

            const canvas = document.createElement("canvas");
            const scale = Math.min(1, THUMBNAIL_MAX_WIDTH / video.videoWidth);
            canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
            canvas.height = Math.max(1, Math.round(video.videoHeight * scale));

            const context = canvas.getContext("2d");
            if (!context) {
                fail("Could not get canvas context");
                return;
            }

            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => {
                if (!blob) {
                    fail("Could not create thumbnail blob");
                    return;
                }

                cleanup();
                const fileStem = file.name.replace(/\.[^.]+$/, "");
                resolve(new File([blob], `${fileStem}_thumb.jpg`, {type: "image/jpeg"}));
            }, "image/jpeg");
        }

        function handleError() {
            fail("Could not load video");
        }

        function handleAbort() {
            fail("Thumbnail extraction was cancelled");
        }

        video.preload = "metadata";
        video.muted = true;
        video.playsInline = true;
        video.addEventListener("loadedmetadata", handleLoadedMetadata);
        video.addEventListener("seeked", handleSeeked);
        video.addEventListener("error", handleError);
        signal.addEventListener("abort", handleAbort, {once: true});
        video.src = sourceUrl;
        video.load();
    });
};
