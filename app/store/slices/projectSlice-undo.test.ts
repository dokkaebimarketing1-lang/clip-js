import {configureStore} from '@reduxjs/toolkit';
import {describe, expect, it} from 'vitest';
import type {MediaFile, ProjectState, TextElement} from '@/app/types';
import {createDefaultWorkflow} from '@/app/lib/workflow/schema';
import {createProjectHistoryMiddleware, PROJECT_HISTORY_LIMIT} from '../project-history';
import projectReducer, {
  acknowledgeProjectRevision,
  createNewProject,
  initialState,
  redo,
  rehydrate,
  setActiveElement,
  setActiveElementIndex,
  setActiveSection,
  setCurrentTime,
  setIsMuted,
  setIsPlaying,
  setMarkerTrack,
  setMediaFiles,
  setProjectName,
  setTextElements,
  setTimelineZoom,
  setWorkflow,
  undo,
} from './projectSlice';

const media = (id: string, positionStart = 0): MediaFile => ({
  id,
  fileName: `${id}.mp4`,
  fileId: id,
  source: {kind: 'indexeddb', fileId: id},
  type: 'video',
  startTime: 0,
  endTime: 2,
  positionStart,
  positionEnd: positionStart + 2,
  includeInMerge: true,
  playbackSpeed: 1,
  volume: 100,
  zIndex: 1,
  opacity: 100,
});

const text = (id: string): TextElement => ({
  id,
  text: id,
  positionStart: 0,
  positionEnd: 2,
  x: 0,
  y: 0,
});

const createHistoryStore = (project: ProjectState = structuredClone(initialState)) => {
  let currentTimeMs = 0;
  const store = configureStore({
    reducer: {projectState: projectReducer},
    preloadedState: {projectState: project},
    middleware: (getDefaultMiddleware) => getDefaultMiddleware({serializableCheck: false})
      .concat(createProjectHistoryMiddleware(() => currentTimeMs)),
  });
  return {
    store,
    advance: (milliseconds = 801) => { currentTimeMs += milliseconds; },
  };
};

describe('project document undo history', () => {
  it('records the pre-edit snapshot without recursive history', () => {
    const {store} = createHistoryStore();

    store.dispatch(setProjectName('Edited'));

    const state = store.getState().projectState;
    expect(state.history).toHaveLength(1);
    expect(state.history[0]).toMatchObject({projectName: '', history: [], future: []});
  });

  it('undoes media, text, and workflow edits in reverse order', () => {
    const {store, advance} = createHistoryStore();
    const workflow = {...createDefaultWorkflow(), planningStatus: 'approved' as const};
    store.dispatch(setMediaFiles([media('clip')]));
    advance();
    store.dispatch(setTextElements([text('caption')]));
    advance();
    store.dispatch(setWorkflow(workflow));

    store.dispatch(undo());
    expect(store.getState().projectState.workflow.planningStatus).toBe('draft');
    store.dispatch(undo());
    expect(store.getState().projectState.textElements).toEqual([]);
    store.dispatch(undo());
    expect(store.getState().projectState.mediaFiles).toEqual([]);
  });

  it('moves the current document to future and restores it on redo', () => {
    const {store} = createHistoryStore();
    store.dispatch(setMediaFiles([media('clip')]));

    store.dispatch(undo());
    expect(store.getState().projectState.future).toHaveLength(1);
    expect(store.getState().projectState.mediaFiles).toEqual([]);

    store.dispatch(redo());
    expect(store.getState().projectState.mediaFiles).toEqual([media('clip')]);
    expect(store.getState().projectState.future).toEqual([]);
  });

  it('clears redo history when a new edit follows undo', () => {
    const {store, advance} = createHistoryStore();
    store.dispatch(setProjectName('First'));
    advance();
    store.dispatch(setProjectName('Second'));
    store.dispatch(undo());
    expect(store.getState().projectState.future).toHaveLength(1);

    store.dispatch(setTextElements([text('replacement')]));

    expect(store.getState().projectState.future).toEqual([]);
  });

  it('does not record transient actions and preserves transient state through undo', () => {
    const {store} = createHistoryStore();
    store.dispatch(setProjectName('Edited'));
    store.dispatch(setCurrentTime(5));
    store.dispatch(setIsPlaying(true));
    store.dispatch(setIsMuted(true));
    store.dispatch(setActiveElement('text'));
    store.dispatch(setActiveElementIndex(4));
    store.dispatch(setTimelineZoom(75));
    store.dispatch(setMarkerTrack(false));
    store.dispatch(setActiveSection('export'));
    expect(store.getState().projectState.history).toHaveLength(1);

    store.dispatch(undo());

    expect(store.getState().projectState).toMatchObject({
      projectName: '',
      currentTime: 5,
      isPlaying: true,
      isMuted: true,
      activeElement: 'text',
      activeElementIndex: 4,
      timelineZoom: 75,
      enableMarkerTracking: false,
      activeSection: 'export',
    });
  });

  it('coalesces same-action drag bursts into one undo step', () => {
    const {store, advance} = createHistoryStore();
    store.dispatch(setMediaFiles([media('clip', 1)]));
    advance(100);
    store.dispatch(setMediaFiles([media('clip', 2)]));
    advance(700);
    store.dispatch(setMediaFiles([media('clip', 3)]));
    expect(store.getState().projectState.history).toHaveLength(1);

    store.dispatch(undo());

    expect(store.getState().projectState.mediaFiles).toEqual([]);
  });

  it('undoes a coalesced visual transform and crop gesture', () => {
    const original = media('clip');
    const project = {...structuredClone(initialState), mediaFiles: [original]};
    const {store, advance} = createHistoryStore(project);
    store.dispatch(setMediaFiles([{
      ...original,
      transform: {x: 0.1, y: -0.2, rotation: 12, scale: 1.1},
    }]));
    advance(100);
    store.dispatch(setMediaFiles([{
      ...original,
      transform: {x: 0.2, y: -0.1, rotation: 24, scale: 1.25},
      crop: {left: 0.1, top: 0.2, width: 0.7, height: 0.6},
    }]));

    expect(store.getState().projectState.history).toHaveLength(1);
    store.dispatch(undo());
    expect(store.getState().projectState.mediaFiles).toEqual([original]);
  });

  it('starts a new undo step after the coalescing window', () => {
    const {store, advance} = createHistoryStore();
    store.dispatch(setMediaFiles([media('clip', 1)]));
    advance(801);
    store.dispatch(setMediaFiles([media('clip', 2)]));

    expect(store.getState().projectState.history).toHaveLength(2);
  });

  it('drops the oldest snapshots at the history cap', () => {
    const {store, advance} = createHistoryStore();
    for (let index = 1; index <= PROJECT_HISTORY_LIMIT + 5; index += 1) {
      store.dispatch(setProjectName(`Edit ${index}`));
      advance();
    }

    const state = store.getState().projectState;
    expect(state.history).toHaveLength(PROJECT_HISTORY_LIMIT);
    expect(state.history[0].projectName).toBe('Edit 5');
  });

  it('preserves the current durable revision when restoring an older document', () => {
    const {store} = createHistoryStore();
    store.dispatch(setProjectName('Edited'));
    store.dispatch(acknowledgeProjectRevision({projectId: initialState.id, revision: 7}));

    store.dispatch(undo());

    expect(store.getState().projectState).toMatchObject({projectName: '', revision: 7});
  });

  it('starts rehydrated and newly created projects with clean history', () => {
    const {store} = createHistoryStore();
    store.dispatch(setProjectName('Edited'));
    const loaded = {...structuredClone(initialState), projectName: 'Loaded', history: [structuredClone(initialState)], future: [structuredClone(initialState)]};

    store.dispatch(rehydrate(loaded));
    expect(store.getState().projectState).toMatchObject({projectName: 'Loaded', history: [], future: []});
    store.dispatch(setProjectName('Changed'));
    store.dispatch(createNewProject());
    expect(store.getState().projectState).toMatchObject({history: [], future: []});
  });
});
