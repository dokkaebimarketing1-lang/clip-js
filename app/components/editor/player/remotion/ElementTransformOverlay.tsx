'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import {Crop as CropIcon} from 'lucide-react';
import {throttle} from 'lodash';
import Moveable, {
  type OnClip,
  type OnDrag,
  type OnDragStart,
  type OnRotate,
  type OnScale,
} from 'react-moveable';
import {useAppDispatch, useAppSelector} from '@/app/store';
import {setMediaFiles, setTextElements} from '@/app/store/slices/projectSlice';
import type {ElementTransform, MediaFile, NormalizedCrop, TextElement} from '@/app/types';
import {cropFromInsetClipStyles, cropToClipPath, elementTransformCss} from '@/app/lib/editor/element-geometry';

const TRANSFORM_DIRECTIONS = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'] as const;
const DEFAULT_TRANSFORM: ElementTransform = {x: 0, y: 0, rotation: 0, scale: 1};
const FULL_CROP: NormalizedCrop = {left: 0, top: 0, width: 1, height: 1};

type SelectedElement =
  | {kind: 'media'; value: MediaFile}
  | {kind: 'text'; value: TextElement};

type DragSession = {
  readonly clientX: number;
  readonly clientY: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly transform: ElementTransform;
};

const findCompositionRect = (
  target: HTMLElement,
  container: HTMLElement,
  resolution: {readonly width: number; readonly height: number},
): DOMRect => {
  let current: HTMLElement | null = target;
  while (current && current !== container) {
    if (current.offsetWidth === resolution.width && current.offsetHeight === resolution.height) {
      return current.getBoundingClientRect();
    }
    current = current.parentElement;
  }
  return container.getBoundingClientRect();
};

const currentTransform = (selected: SelectedElement): ElementTransform => selected.value.transform ?? {
  ...DEFAULT_TRANSFORM,
  rotation: selected.kind === 'media' ? selected.value.rotation ?? 0 : 0,
};

export const ElementTransformOverlay = ({container}: {container: HTMLDivElement | null}) => {
  const dispatch = useAppDispatch();
  const project = useAppSelector((state) => state.projectState);
  const {activeElement, activeElementIndex, currentTime, mediaFiles, resolution, textElements} = project;
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [cropMode, setCropMode] = useState(false);
  const moveableRef = useRef<Moveable | null>(null);
  const dragSessionRef = useRef<DragSession | null>(null);
  const mediaFilesRef = useRef(mediaFiles);
  const textElementsRef = useRef(textElements);

  const selected = useMemo<SelectedElement | undefined>(() => {
    if (activeElement === 'media') {
      const value = mediaFiles[activeElementIndex];
      return value && value.type !== 'audio' && value.type !== 'unknown' ? {kind: 'media', value} : undefined;
    }
    if (activeElement === 'text') {
      const value = textElements[activeElementIndex];
      return value ? {kind: 'text', value} : undefined;
    }
    return undefined;
  }, [activeElement, activeElementIndex, mediaFiles, textElements]);
  const selectedCrop = selected?.kind === 'media' ? selected.value.crop : undefined;

  useEffect(() => {
    mediaFilesRef.current = mediaFiles;
    textElementsRef.current = textElements;
  }, [mediaFiles, textElements]);

  const updateTransform = useMemo(() => throttle((kind: SelectedElement['kind'], id: string, transform: ElementTransform) => {
    if (kind === 'media') {
      const updated = mediaFilesRef.current.map((media) => media.id === id ? {...media, transform} : media);
      mediaFilesRef.current = updated;
      dispatch(setMediaFiles(updated));
      return;
    }
    const updated = textElementsRef.current.map((text) => text.id === id ? {...text, transform} : text);
    textElementsRef.current = updated;
    dispatch(setTextElements(updated));
  }, 100), [dispatch]);

  const updateCrop = useMemo(() => throttle((id: string, crop: NormalizedCrop) => {
    const updated = mediaFilesRef.current.map((media) => media.id === id ? {...media, crop} : media);
    mediaFilesRef.current = updated;
    dispatch(setMediaFiles(updated));
  }, 100), [dispatch]);

  useEffect(() => () => {
    updateTransform.cancel();
    updateCrop.cancel();
  }, [updateCrop, updateTransform]);

  useEffect(() => {
    setCropMode(false);
  }, [selected?.kind, selected?.value.id]);

  useEffect(() => {
    if (!container || !selected) {
      setTarget(null);
      return;
    }
    const frame = requestAnimationFrame(() => {
      const match = Array.from(container.querySelectorAll<HTMLElement>('[data-editor-element-id]'))
        .find((element) => element.dataset.editorElementId === selected.value.id
          && element.dataset.editorElementType === selected.kind);
      setTarget(match ?? null);
    });
    return () => cancelAnimationFrame(frame);
  }, [container, currentTime, selected]);

  useEffect(() => {
    moveableRef.current?.updateRect();
  }, [cropMode, selectedCrop, selected?.value.transform, target]);

  if (!container || !selected || !target) return null;
  const transform = currentTransform(selected);
  const applyTransform = (next: ElementTransform): void => {
    target.style.transform = elementTransformCss(next, resolution) ?? '';
    updateTransform(selected.kind, selected.value.id, next);
  };

  const handleDragStart = (event: OnDragStart): void => {
    const rect = findCompositionRect(target, container, resolution);
    const start = currentTransform(selected);
    event.set([start.x * resolution.width, start.y * resolution.height]);
    dragSessionRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      canvasWidth: rect.width,
      canvasHeight: rect.height,
      transform: start,
    };
  };

  const handleDrag = (event: OnDrag): void => {
    const session = dragSessionRef.current;
    if (!session || session.canvasWidth <= 0 || session.canvasHeight <= 0) return;
    applyTransform({
      ...session.transform,
      x: session.transform.x + (event.clientX - session.clientX) / session.canvasWidth,
      y: session.transform.y + (event.clientY - session.clientY) / session.canvasHeight,
    });
  };

  const handleScale = (event: OnScale): void => {
    const scale = Math.max(0.05, event.scale[0] ?? transform.scale);
    applyTransform({...transform, scale});
  };

  const handleRotate = (event: OnRotate): void => {
    applyTransform({...transform, rotation: event.rotation});
  };

  const handleClip = (event: OnClip): void => {
    if (selected.kind !== 'media') return;
    const crop = cropFromInsetClipStyles(event.clipStyles);
    if (!crop) return;
    target.style.clipPath = event.clipStyle;
    updateCrop(selected.value.id, crop);
  };

  return (
    <>
      {selected.kind === 'media' && (
        <button
          type="button"
          aria-pressed={cropMode}
          aria-label={cropMode ? '자르기 모드 종료' : '자르기 모드 시작'}
          className={`absolute right-3 top-3 z-40 flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-bold backdrop-blur transition-colors focus:outline-none focus:ring-2 focus:ring-fuchsia-400 ${cropMode ? 'border-fuchsia-400 bg-fuchsia-500/90 text-white' : 'border-white/15 bg-black/70 text-gray-200 hover:bg-black/85'}`}
          onClick={() => setCropMode((enabled) => !enabled)}
        >
          <CropIcon aria-hidden="true" size={14} />
          자르기
        </button>
      )}
      <Moveable
        ref={moveableRef}
        target={target}
        container={container}
        origin={false}
        draggable={!cropMode}
        scalable={!cropMode}
        rotatable={!cropMode}
        clippable={cropMode}
        renderDirections={cropMode ? [] : [...TRANSFORM_DIRECTIONS]}
        keepRatio
        throttleDrag={0}
        throttleScale={0}
        throttleRotate={0}
        rotationPosition="top"
        defaultClipPath="inset"
        customClipPath={cropMode ? cropToClipPath(selected.kind === 'media' ? selected.value.crop ?? FULL_CROP : FULL_CROP) : undefined}
        clipRelative
        clipArea
        clipTargetBounds
        dragWithClip={false}
        onDragStart={handleDragStart}
        onDrag={handleDrag}
        onDragEnd={() => updateTransform.flush()}
        onScaleStart={({set, setFixedDirection}) => {
          set([transform.scale, transform.scale]);
          setFixedDirection([0, 0]);
        }}
        onScale={handleScale}
        onScaleEnd={() => updateTransform.flush()}
        onRotateStart={({set}) => set(transform.rotation)}
        onRotate={handleRotate}
        onRotateEnd={() => updateTransform.flush()}
        onClip={handleClip}
        onClipEnd={() => updateCrop.flush()}
      />
    </>
  );
};
