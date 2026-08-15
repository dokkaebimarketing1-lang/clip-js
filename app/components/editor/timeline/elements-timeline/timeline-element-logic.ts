import type {PayloadAction} from '@reduxjs/toolkit';
import {throttle} from 'lodash';
import {useCallback, useEffect, useMemo, useRef} from 'react';
import type Moveable from 'react-moveable';
import {useDispatch} from 'react-redux';
import type {ActiveElement} from '@/app/types';
import {setActiveElement, setActiveElementIndex} from '@/app/store/slices/projectSlice';

export const MINIMUM_TIMELINE_DURATION = 0.1;
const TIMELINE_UPDATE_THROTTLE_MS = 100;

type TimelineElementIdentity = {
  readonly id: string;
};

type TimelinePosition = TimelineElementIdentity & {
  readonly positionStart: number;
  readonly positionEnd: number;
};

type TimelineElementKind = Extract<ActiveElement, 'media' | 'text'>;
type TimelineElementActionCreator<T> = (elements: T[]) => PayloadAction<T[]>;
type TimelineElementUpdater<T> = (id: string, updates: Partial<T>) => void;

type TimelineDrag = {
  readonly constrainedLeft: number;
  readonly positionStart: number;
  readonly positionDelta: number;
};

type TimelineEastResize = {
  readonly resizedDuration: number;
  readonly positionEnd: number;
};

type TimelineWestResize = {
  readonly resizedDuration: number;
  readonly positionStart: number;
  readonly trimDelta: number;
  readonly renderedLeft: number;
  readonly renderedWidth: number;
};

export const timelinePixelsToUnits = (pixels: number, timelineZoom: number): number =>
  pixels / timelineZoom;

export const calculateTimelineDrag = (
  previousPositionStart: number,
  left: number,
  timelineZoom: number,
): TimelineDrag => {
  const constrainedLeft = Math.max(left, 0);
  const positionStart = timelinePixelsToUnits(constrainedLeft, timelineZoom);
  return {
    constrainedLeft,
    positionStart,
    positionDelta: positionStart - previousPositionStart,
  };
};

export const calculateEastResize = (
  positionStart: number,
  width: number,
  timelineZoom: number,
): TimelineEastResize => {
  const resizedDuration = timelinePixelsToUnits(width, timelineZoom);
  return {
    resizedDuration,
    positionEnd: positionStart + resizedDuration,
  };
};

export const calculateWestResize = (
  previousPositionStart: number,
  positionEnd: number,
  width: number,
  timelineZoom: number,
): TimelineWestResize => {
  const resizedDuration = timelinePixelsToUnits(width, timelineZoom);
  const maximumPositionStart = Math.max(positionEnd - MINIMUM_TIMELINE_DURATION, 0);
  const positionStart = Math.min(
    Math.max(positionEnd - resizedDuration, 0),
    maximumPositionStart,
  );

  return {
    resizedDuration,
    positionStart,
    trimDelta: positionStart - previousPositionStart,
    renderedLeft: positionStart * timelineZoom,
    renderedWidth: (positionEnd - positionStart) * timelineZoom,
  };
};

export const calculateTrimmedStartTime = (startTime: number, trimDelta: number): number =>
  Math.max(startTime + trimDelta, 0);

export const applyDragPosition = (target: HTMLElement, constrainedLeft: number): void => {
  target.style.left = `${constrainedLeft}px`;
};

export const applyResizeWidth = (target: HTMLElement, width: number, widthDelta: number): void => {
  if (widthDelta) target.style.width = `${width}px`;
};

export const applyWestResizePosition = (
  target: HTMLElement,
  resize: TimelineWestResize,
): void => {
  target.style.left = `${resize.renderedLeft}px`;
  target.style.width = `${resize.renderedWidth}px`;
};

export const useThrottledTimelineElementUpdate = <T extends TimelineElementIdentity>(
  elements: readonly T[],
  createAction: TimelineElementActionCreator<T>,
): TimelineElementUpdater<T> => {
  const dispatch = useDispatch();
  const elementsRef = useRef(elements);

  useEffect(() => {
    elementsRef.current = elements;
  }, [elements]);

  return useMemo(
    () => throttle((id: string, updates: Partial<T>) => {
      const updated = elementsRef.current.map((element) =>
        element.id === id ? {...element, ...updates} : element,
      );
      dispatch(createAction(updated));
    }, TIMELINE_UPDATE_THROTTLE_MS),
    [createAction, dispatch],
  );
};

export const useTimelineElementSelection = <T extends TimelineElementIdentity>(
  elementKind: TimelineElementKind,
  elements: readonly T[],
): ((id: string) => void) => {
  const dispatch = useDispatch();

  return useCallback((id: string) => {
    dispatch(setActiveElement(elementKind));
    const actualIndex = elements.findIndex((element) => element.id === id);
    dispatch(setActiveElementIndex(actualIndex));
  }, [dispatch, elementKind, elements]);
};

export const useTimelineElementRefs = (
  elements: readonly TimelinePosition[],
  timelineZoom: number,
) => {
  const targetRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const moveableRefs = useRef<Record<string, Moveable | null>>({});

  const setTargetRef = useCallback((id: string, target: HTMLDivElement | null) => {
    if (target) targetRefs.current[id] = target;
  }, []);

  const setMoveableRef = useCallback((id: string, moveable: Moveable | null) => {
    if (moveable) moveableRefs.current[id] = moveable;
  }, []);

  const getTarget = useCallback((id: string): HTMLDivElement | null =>
    targetRefs.current[id] || null, []);

  useEffect(() => {
    for (const element of elements) {
      moveableRefs.current[element.id]?.updateRect();
    }
  }, [timelineZoom]);

  return {getTarget, setMoveableRef, setTargetRef};
};
