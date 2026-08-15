import {isAnyOf, type Middleware} from '@reduxjs/toolkit';
import type {ProjectState} from '@/app/types';
import {
  createNewProject,
  PROJECT_HISTORY_LIMIT,
  recordProjectHistory,
  redo,
  rehydrate,
  setExportSettings,
  setFps,
  setIncludeSubtitles,
  setMediaFiles,
  setProjectName,
  setQuality,
  setResolution,
  setSpeed,
  setTextElements,
  setWorkflow,
  undo,
} from './slices/projectSlice';

export {PROJECT_HISTORY_LIMIT};

const HISTORY_COALESCE_MS = 800;
const isUndoableProjectAction = isAnyOf(
  setMediaFiles,
  setTextElements,
  setWorkflow,
  setProjectName,
  setExportSettings,
  setIncludeSubtitles,
  setResolution,
  setQuality,
  setSpeed,
  setFps,
);

type ProjectHistoryRootState = {
  projectState: ProjectState;
};

const withoutNestedHistory = (project: ProjectState): ProjectState => ({
  ...project,
  history: [],
  future: [],
});

export const createProjectHistoryMiddleware = (
  now: () => number = Date.now,
): Middleware<object, ProjectHistoryRootState> => {
  let lastActionType: string | undefined;
  let lastActionAt = Number.NEGATIVE_INFINITY;

  return ({dispatch, getState}) => (next) => (action) => {
    if (undo.match(action) || redo.match(action) || rehydrate.match(action) || createNewProject.match(action)) {
      lastActionType = undefined;
      lastActionAt = Number.NEGATIVE_INFINITY;
      return next(action);
    }
    if (!isUndoableProjectAction(action)) return next(action);

    const timestamp = now();
    const project = getState().projectState;
    const replaceLatest = action.type === lastActionType
      && timestamp - lastActionAt <= HISTORY_COALESCE_MS
      && project.history.length > 0
      && project.future.length === 0;
    const snapshot = replaceLatest
      ? project.history[project.history.length - 1]
      : project;
    dispatch(recordProjectHistory({
      snapshot: withoutNestedHistory(snapshot),
      replaceLatest,
    }));
    lastActionType = action.type;
    lastActionAt = timestamp;
    return next(action);
  };
};
