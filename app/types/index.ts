import type {WorkflowState} from '@/app/lib/workflow/schema';

export type MediaType = 'video' | 'audio' | 'image' | 'unknown';

export type MediaSource =
    | {kind: 'indexeddb'; fileId: string}
    | {kind: 'generated'; generatedAssetId: string}
    | {kind: 'managed'; assetId: string}
    | {kind: 'external-unverified'; url: string};

/**
 * Visual transform relative to an element's existing layout rectangle.
 * x/y are composition-normalized offsets (1 = full canvas width/height),
 * rotation is clockwise degrees, and scale is a uniform center-origin factor.
 */
export interface ElementTransform {
    x: number;
    y: number;
    rotation: number;
    scale: number;
}

/** Normalized visible source rectangle; left + width and top + height are at most 1. */
export interface NormalizedCrop {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface UploadedFile {
    id: string;
    file: File;
    type?: MediaType;
    src?: string;
}

export interface MediaFile {
    id: string;
    fileName: string;
    /** @deprecated Read only at the legacy IndexedDB migration boundary. */
    fileId?: string;
    source?: MediaSource;
    type: MediaType;
    startTime: number;  // within the source video
    src?: string;
    endTime: number;
    positionStart: number;  // position in the final video
    positionEnd: number;
    includeInMerge: boolean;
    playbackSpeed: number;
    volume: number;
    zIndex: number;

    // Optional visual settings
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    rotation?: number;
    opacity?: number;
    transform?: ElementTransform;

    // Effects
    crop?: NormalizedCrop;

    // Workflow provenance. Remote URLs are persisted for deterministic
    // Remotion rendering; `src` remains a browser-only object URL.
    remoteUrl?: string;
    provider?: 'local' | 'higgsfield' | 'byteplus';
    model?: string;
    jobId?: string;
    generatedAssetId?: string;
    contentSha256?: string;
    takeId?: string;
    cutId?: string;
    shotId?: string;
    storyboardRole?: 'start' | 'end' | 'clip' | 'audio' | 'storyboard-sheet';
}

export interface TextElement {
    id: string;
    text: string;                     // The actual text content
    includeInMerge?: boolean;

    // Timing
    positionStart: number;           // When text appears in final video
    positionEnd: number;             // When text disappears

    // Position & Size (canvas-based)
    x: number;
    y: number;
    width?: number;
    height?: number;

    // Styling
    font?: string;                   // Font family (e.g., 'Arial', 'Roboto')
    fontSize?: number;               // Font size in pixels
    color?: string;                  // Text color (hex or rgba)
    backgroundColor?: string;       // Background behind text
    align?: 'left' | 'center' | 'right'; // Horizontal alignment
    zIndex?: number;                 // Layering

    // Effects
    opacity?: number;                // Transparency (0 to 1)
    rotation?: number;               // Rotation in degrees
    transform?: ElementTransform;
    fadeInDuration?: number;        // Seconds to fade in
    fadeOutDuration?: number;       // Seconds to fade out
    animation?: 'slide-in' | 'zoom' | 'bounce' | 'none'; // Optional animation

    // Runtime only (not persisted)
    visible?: boolean;              // Internal flag for rendering logic
}

export interface ShapeElement {
    id: string;
    type: 'rect' | 'circle' | 'line';
    positionStart: number;
    positionEnd: number;
    x: number;
    y: number;
    width: number;
    height: number;
    color: string;
    opacity: number;
    zIndex: number;
    transform?: ElementTransform;
    rotation?: number;
}


export type ExportFormat = 'mp4' | 'webm' | 'gif' | 'mov';

export interface ExportConfig {
    resolution: string;
    quality: string;
    speed: string;
    fps: number; // TODO: add this as an option
    format: ExportFormat; // TODO: add this as an option
    includeSubtitles: boolean; // TODO: add this as an option
}

export type ActiveElement = 'media' | 'text' | 'shape' | 'workflow' | 'export';


export interface ProjectState {
    projectSchemaVersion: 3;
    revision: number;
    id: string;
    mediaFiles: MediaFile[];
    textElements: TextElement[];
    shapes: ShapeElement[];
    filesID?: string[],
    currentTime: number;
    isPlaying: boolean;
    isMuted: boolean;
    duration: number;
    zoomLevel: number;
    timelineZoom: number;
    enableMarkerTracking: boolean;
    projectName: string;
    createdAt: string;
    lastModified: string;
    activeSection: ActiveElement;
    activeElement: ActiveElement | null;
    activeElementIndex: number;

    resolution: { width: number; height: number };
    fps: number;
    aspectRatio: string;
    history: ProjectState[]; // stack for undo
    future: ProjectState[]; // stack for redo
    exportSettings: ExportConfig;
    workflow: WorkflowState;
}

export const mimeToExt = {
    'video/mp4': 'mp4',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'video/webm': 'webm',
    // TODO: Add more as needed
};
