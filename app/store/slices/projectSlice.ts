import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { TextElement, MediaFile, ActiveElement, ExportConfig } from '../../types';
import { ProjectState } from '../../types';
import {createDefaultWorkflow, type WorkflowState, workflowStateSchema} from '@/app/lib/workflow/schema';
import {
    invalidateApproval,
    invalidateForCreativeChange,
    invalidateForGenerationChange,
    invalidateForReleaseChange,
} from '@/app/lib/workflow/approval';
import {generationInputs} from '@/app/lib/workflow/approval-v3';
import {deriveProductionFromStoryboard} from '@/app/lib/workflow/storyboard-converter';
import type {CreativeApprovalCommand} from '@/app/lib/workflow/creative-approval-apply';
import type {StoryboardInstallCommand} from '@/app/lib/workflow/storyboard-apply';
import {isPlanningRequestCurrent, type PlanningInstallCommand} from '@/app/lib/workflow/planning-apply';

export const initialState: ProjectState = {
    projectSchemaVersion: 3,
    revision: 0,
    id: crypto.randomUUID(),
    projectName: '',
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
    mediaFiles: [],
    textElements: [],
    currentTime: 0,
    isPlaying: false,
    isMuted: false,
    duration: 0,
    zoomLevel: 1,
    timelineZoom: 100,
    enableMarkerTracking: true,
    activeSection: 'media',
    activeElement: null,
    activeElementIndex: 0,
    resolution: { width: 1920, height: 1080 },
    fps: 30,
    aspectRatio: '16:9',
    history: [],
    future: [],
    exportSettings: {
        resolution: '1080p',
        quality: 'high',
        speed: 'fastest',
        fps: 30,
        format: 'mp4',
        includeSubtitles: true,
    },
    workflow: createDefaultWorkflow(),
};

const calculateTotalDuration = (
    mediaFiles: MediaFile[],
    textElements: TextElement[],
    captionEnd = 0
): number => {
    const mediaDurations = mediaFiles.map(v => v.positionEnd);
    const textDurations = textElements.map(v => v.positionEnd);
    return Math.max(0, captionEnd, ...mediaDurations, ...textDurations);
};

const projectStateSlice = createSlice({
    name: 'projectState',
    initialState,
    reducers: {
        setMediaFiles: (state, action: PayloadAction<MediaFile[]>) => {
            const semantic = (files: MediaFile[]) => files.map((media) => {
                const persisted = {...media};
                delete persisted.src;
                return persisted;
            });
            const changed = JSON.stringify(semantic(state.mediaFiles as MediaFile[])) !== JSON.stringify(semantic(action.payload));
            state.mediaFiles = action.payload;
            if (changed) state.workflow.releaseApproval = invalidateApproval(state.workflow.releaseApproval);
            // Calculate duration based on the last video's end time
            const captionEnd = state.workflow.captions.reduce((max, cue) => Math.max(max, cue.endSeconds), 0);
            state.duration = calculateTotalDuration(state.mediaFiles, state.textElements, captionEnd);
        },
        setProjectName: (state, action: PayloadAction<string>) => {
            state.projectName = action.payload;
        },
        setProjectId: (state, action: PayloadAction<string>) => {
            state.id = action.payload;
        },
        setProjectCreatedAt: (state, action: PayloadAction<string>) => {
            state.createdAt = action.payload;
        },
        setProjectLastModified: (state, action: PayloadAction<string>) => {
            state.lastModified = action.payload;
        },

        setTextElements: (state, action: PayloadAction<TextElement[]>) => {
            state.textElements = action.payload;
            state.workflow.releaseApproval = invalidateApproval(state.workflow.releaseApproval);
            const captionEnd = state.workflow.captions.reduce((max, cue) => Math.max(max, cue.endSeconds), 0);
            state.duration = calculateTotalDuration(state.mediaFiles, state.textElements, captionEnd);
        },
        setCurrentTime: (state, action: PayloadAction<number>) => {
            state.currentTime = action.payload;
        },
        setIsPlaying: (state, action: PayloadAction<boolean>) => {
            state.isPlaying = action.payload;
        },
        setIsMuted: (state, action: PayloadAction<boolean>) => {
            state.isMuted = action.payload;
        },
        setActiveSection: (state, action: PayloadAction<ActiveElement>) => {
            state.activeSection = action.payload;
        },
        setActiveElement: (state, action: PayloadAction<ActiveElement | null>) => {
            state.activeElement = action.payload;
        },
        setActiveElementIndex: (state, action: PayloadAction<number>) => {
            state.activeElementIndex = action.payload;
        },
        setFilesID: (state, action: PayloadAction<string[]>) => {
            state.filesID = action.payload;
        },
        setExportSettings: (state, action: PayloadAction<ExportConfig>) => {
            state.exportSettings = action.payload;
            state.workflow.releaseApproval = invalidateApproval(state.workflow.releaseApproval);
        },
        setWorkflow: (state, action: PayloadAction<WorkflowState>) => {
            const nextWorkflow = action.payload;
            const storyboardChanged = JSON.stringify(state.workflow.storyboard ?? null) !== JSON.stringify(nextWorkflow.storyboard ?? null);
            const generationInputsChanged = JSON.stringify(generationInputs(state.workflow.production)) !== JSON.stringify(generationInputs(nextWorkflow.production))
                || JSON.stringify(state.workflow.seedanceMaster) !== JSON.stringify(nextWorkflow.seedanceMaster);
            const releaseInputsChanged = JSON.stringify(state.workflow.production.takes) !== JSON.stringify(nextWorkflow.production.takes)
                || JSON.stringify(state.workflow.transitions) !== JSON.stringify(nextWorkflow.transitions)
                || JSON.stringify(state.workflow.effects) !== JSON.stringify(nextWorkflow.effects)
                || JSON.stringify(state.workflow.captions) !== JSON.stringify(nextWorkflow.captions)
                || JSON.stringify(state.workflow.postProduction) !== JSON.stringify(nextWorkflow.postProduction);
            state.workflow = storyboardChanged
                ? invalidateForCreativeChange(nextWorkflow)
                : generationInputsChanged
                    ? invalidateForGenerationChange(nextWorkflow)
                    : releaseInputsChanged
                        ? invalidateForReleaseChange(nextWorkflow)
                        : nextWorkflow;
            const mediaEnd = state.mediaFiles.reduce((maximum, item) => Math.max(maximum, item.positionEnd), 0);
            const textEnd = state.textElements.reduce((max, item) => Math.max(max, item.positionEnd), 0);
            const captionEnd = nextWorkflow.captions.reduce((max, cue) => Math.max(max, cue.endSeconds), 0);
            state.duration = Math.max(mediaEnd, textEnd, captionEnd);
        },
        setPlanningStatus: (state, action: PayloadAction<'draft' | 'approved'>) => {
            state.workflow.planningStatus = action.payload;
        },
        installPlanningIfCurrent: (state, action: PayloadAction<PlanningInstallCommand>) => {
            if (!isPlanningRequestCurrent(state.workflow, action.payload.expectedWorkflow)) return;
            const nextWorkflow = invalidateForCreativeChange({
                ...state.workflow,
                planningStatus: 'draft',
                interviewBrief: action.payload.interviewBrief,
                styleBible: action.payload.styleBible,
                styleBibleHash: action.payload.styleBibleHash,
                characterSheet: action.payload.characterSheets[0],
                characterSheets: action.payload.characterSheets,
                storyboard: undefined,
                seedanceMaster: action.payload.seedanceMaster,
            });
            state.workflow = workflowStateSchema.parse(nextWorkflow);
        },
        acknowledgeProjectRevision: (state, action: PayloadAction<{projectId: string; revision: number}>) => {
            if (state.id !== action.payload.projectId) return;
            if (!Number.isSafeInteger(action.payload.revision) || action.payload.revision <= state.revision) return;
            state.revision = action.payload.revision;
        },
        installStoryboardIfCurrent: (state, action: PayloadAction<StoryboardInstallCommand>) => {
            const currentSheets = state.workflow.characterSheets ?? (state.workflow.characterSheet ? [state.workflow.characterSheet] : []);
            if (
                JSON.stringify(state.workflow.interviewBrief ?? null) !== JSON.stringify(action.payload.expectedInterviewBrief)
                || JSON.stringify(state.workflow.styleBible ?? null) !== JSON.stringify(action.payload.expectedStyleBible)
                || state.workflow.styleBibleHash !== action.payload.expectedStyleBibleHash
                || JSON.stringify(currentSheets) !== JSON.stringify(action.payload.expectedCharacterSheets)
            ) return;
            state.workflow = invalidateForCreativeChange({...state.workflow, storyboard: action.payload.storyboard});
        },
        installCreativeApprovalIfCurrent: (state, action: PayloadAction<CreativeApprovalCommand>) => {
            const currentSheets = state.workflow.characterSheets ?? (state.workflow.characterSheet ? [state.workflow.characterSheet] : []);
            if (
                JSON.stringify(state.workflow.storyboard ?? null) !== JSON.stringify(action.payload.expectedStoryboard)
                || JSON.stringify(currentSheets) !== JSON.stringify(action.payload.expectedCharacterSheets)
            ) return;
            state.workflow.creativeApproval = action.payload.approval;
            state.workflow.generationApproval = {status: 'invalidated'};
            state.workflow.releaseApproval = {status: 'invalidated'};
            state.workflow.production = deriveProductionFromStoryboard(action.payload.expectedStoryboard, state.workflow.production);
        },
        setIncludeSubtitles: (state, action: PayloadAction<boolean>) => {
            state.exportSettings.includeSubtitles = action.payload;
            state.workflow.releaseApproval = invalidateApproval(state.workflow.releaseApproval);
        },
        setResolution: (state, action: PayloadAction<string>) => {
            state.exportSettings.resolution = action.payload;
            state.workflow.releaseApproval = invalidateApproval(state.workflow.releaseApproval);
        },
        setQuality: (state, action: PayloadAction<string>) => {
            state.exportSettings.quality = action.payload;
            state.workflow.releaseApproval = invalidateApproval(state.workflow.releaseApproval);
        },
        setSpeed: (state, action: PayloadAction<string>) => {
            state.exportSettings.speed = action.payload;
            state.workflow.releaseApproval = invalidateApproval(state.workflow.releaseApproval);
        },
        setFps: (state, action: PayloadAction<number>) => {
            state.exportSettings.fps = action.payload;
            state.workflow.releaseApproval = invalidateApproval(state.workflow.releaseApproval);
        },
        setTimelineZoom: (state, action: PayloadAction<number>) => {
            state.timelineZoom = action.payload;
        },
        setMarkerTrack: (state, action: PayloadAction<boolean>) => {
            state.enableMarkerTracking = action.payload;
        },
        // Special reducer for rehydrating state from IndexedDB
        rehydrate: (state, action: PayloadAction<ProjectState>) => {
            const workflow = action.payload.workflow ?? createDefaultWorkflow();
            const workflowInput = structuredClone(workflow) as unknown as {
                seedanceMaster?: {axes?: {textGeneration?: unknown}};
            };
            const legacyGeneratedText = workflowInput.seedanceMaster?.axes?.textGeneration !== undefined
                && workflowInput.seedanceMaster.axes.textGeneration !== 'none';
            if (legacyGeneratedText && workflowInput.seedanceMaster?.axes) {
                workflowInput.seedanceMaster.axes.textGeneration = 'none';
            }
            const parsedWorkflow = workflowStateSchema.parse(workflowInput);
            const normalizedWorkflow = legacyGeneratedText
                ? invalidateForGenerationChange(parsedWorkflow)
                : parsedWorkflow;
            const duration = calculateTotalDuration(
                action.payload.mediaFiles ?? [],
                action.payload.textElements ?? [],
                normalizedWorkflow.captions.reduce((max, cue) => Math.max(max, cue.endSeconds), 0),
            );
            return {
                ...state,
                ...action.payload,
                projectSchemaVersion: 3,
                revision: Number.isSafeInteger(action.payload.revision) && action.payload.revision >= 0 ? action.payload.revision : 0,
                workflow: normalizedWorkflow,
                duration,
            };
        },
        createNewProject: () => {
            return { ...initialState };
        },
    },
});

export const {
    setMediaFiles,
    setTextElements,
    setCurrentTime,
    setProjectName,
    setIsPlaying,
    setFilesID,
    setExportSettings,
    setWorkflow,
    setPlanningStatus,
    installPlanningIfCurrent,
    acknowledgeProjectRevision,
    installStoryboardIfCurrent,
    installCreativeApprovalIfCurrent,
    setIncludeSubtitles,
    setResolution,
    setQuality,
    setSpeed,
    setFps,
    setMarkerTrack,
    setIsMuted,
    setActiveSection,
    setActiveElement,
    setActiveElementIndex,
    setTimelineZoom,
    rehydrate,
    createNewProject,
} = projectStateSlice.actions;

export default projectStateSlice.reducer; 