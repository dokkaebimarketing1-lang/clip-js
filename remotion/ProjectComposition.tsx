import React, {useEffect, useState} from 'react';
import {
  AbsoluteFill,
  Audio,
  cancelRender,
  continueRender,
  delayRender,
  Freeze,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import {Video} from '@remotion/media';
import {crossZoom, dreamyZoom, filmBurn, linearBlur, linearTiming, TransitionSeries, type TransitionPresentation} from '@remotion/transitions';
import {crosswarp} from '@remotion/transitions/crosswarp';
import {dissolve} from '@remotion/transitions/dissolve';
import {ripple} from '@remotion/transitions/ripple';
import type {EffectDescriptor} from 'remotion';
import type {MediaFile, ProjectState, ShapeElement, TextElement} from '../app/types';
import type {EffectSpec, TransitionSpec} from '../app/lib/workflow/schema';
import {activeEffectsAt, buildRemotionEffects} from './effects';
import {isOfficialTransition} from '../app/lib/workflow/transition-catalog';
import {CaptionContent} from './captions';
import {mediaTransformCss, mediaVisualStyle, textVisualStyle, type CompositionSize} from './element-styles';
import {shapeVisualStyle} from '../app/lib/editor/shape-style';

export interface ProjectCompositionProps extends Record<string, unknown> {
  project: ProjectState;
}

const officialPresentationFor = (type: TransitionSpec['type']): TransitionPresentation<Record<string, unknown>> | null => {
  const presentation = (() => {
    if (type === 'dreamy-zoom') return dreamyZoom({rotation: 0.05, scale: 1.18});
    if (type === 'film-burn') return filmBurn({seed: 7});
    if (type === 'linear-blur') return linearBlur({intensity: 0.35});
    if (type === 'ripple') return ripple({amplitude: 80, speed: 40});
    if (type === 'crosswarp') return crosswarp({});
    if (type === 'dissolve') return dissolve({intensity: 0.8});
    if (type === 'cross-zoom') return crossZoom({strength: 0.35});
    return null;
  })();
  return presentation as unknown as TransitionPresentation<Record<string, unknown>> | null;
};

const mediaSource = (media: MediaFile): string => {
  const source = media.remoteUrl || media.src || '';
  return source.startsWith('/') ? staticFile(source.slice(1)) : source;
};

const MediaLayer: React.FC<{media: MediaFile; fps: number; effects: readonly EffectSpec[]; composition: CompositionSize}> = ({media, fps, effects, composition}) => {
  const frame = useCurrentFrame();
  const from = Math.max(0, Math.round(media.positionStart * fps));
  const durationInFrames = Math.max(1, Math.round((media.positionEnd - media.positionStart) * fps));
  const commonStyle = mediaVisualStyle(media, composition);
  const source = mediaSource(media);
  if (!source) return null;
  const remotionEffects = buildRemotionEffects(activeEffectsAt(effects, media.id, frame / fps));
  return (
    <Sequence from={from} durationInFrames={durationInFrames} layout="none" name={media.fileName}>
      {media.type === 'video' ? (
        <Video
          data-editor-element-id={media.id}
          data-editor-element-type="media"
          src={source}
          trimBefore={Math.max(0, Math.round(media.startTime * fps))}
          trimAfter={Math.max(1, Math.round(media.endTime * fps))}
          playbackRate={media.playbackSpeed || 1}
          volume={(media.volume ?? 100) / 100}
          effects={remotionEffects}
          objectFit="cover"
          style={commonStyle}
        />
      ) : media.type === 'image' ? (
        <Img data-editor-element-id={media.id} data-editor-element-type="media" src={source} effects={remotionEffects} style={{...commonStyle, objectFit: 'cover'}} />
      ) : media.type === 'audio' ? (
        <Audio
          src={source}
          startFrom={Math.max(0, Math.round(media.startTime * fps))}
          endAt={Math.max(1, Math.round(media.endTime * fps))}
          playbackRate={media.playbackSpeed || 1}
          volume={(media.volume ?? 100) / 100}
        />
      ) : null}
    </Sequence>
  );
};

const TextLayer: React.FC<{item: TextElement; fps: number; composition: CompositionSize}> = ({item, fps, composition}) => (
  <Sequence
    from={Math.round(item.positionStart * fps)}
    durationInFrames={Math.max(1, Math.round((item.positionEnd - item.positionStart) * fps))}
    layout="none"
  >
    <div data-editor-element-id={item.id} data-editor-element-type="text" style={textVisualStyle(item, composition)}>
      {item.text}
    </div>
  </Sequence>
);

const ShapeLayer: React.FC<{item: ShapeElement; fps: number; composition: CompositionSize}> = ({item, fps, composition}) => (
  <Sequence
    from={Math.round(item.positionStart * fps)}
    durationInFrames={Math.max(1, Math.round((item.positionEnd - item.positionStart) * fps))}
    layout="none"
  >
    <div data-editor-element-id={item.id} data-editor-element-type="shape" style={shapeVisualStyle(item, composition)} />
  </Sequence>
);

const TransitionAsset: React.FC<{media: MediaFile; fps: number; trimStart: number; style: React.CSSProperties; effects: EffectDescriptor<unknown>[]; composition: CompositionSize}> = ({media, fps, trimStart, style, effects, composition}) => {
  const source = mediaSource(media);
  if (!source || media.type === 'audio') return null;
  const base = {...mediaVisualStyle(media, composition), ...style};
  return media.type === 'image'
    ? <Img src={source} effects={effects} style={{...base, objectFit: 'cover'}} />
    : <Video src={source} trimBefore={Math.max(0, Math.round(trimStart * fps))} playbackRate={media.playbackSpeed || 1} muted effects={effects} objectFit="cover" style={base} />;
};

const TransitionPairContent: React.FC<{transition: TransitionSpec; source: MediaFile; target: MediaFile; fps: number; durationInFrames: number; timelineStartSeconds: number; effects: readonly EffectSpec[]; composition: CompositionSize}> = ({transition, source, target, fps, durationInFrames, timelineStartSeconds, effects, composition}) => {
  const frame = useCurrentFrame();
  const absoluteSeconds = timelineStartSeconds + frame / fps;
  const sourceEffects = buildRemotionEffects(activeEffectsAt(effects, source.id, absoluteSeconds));
  const targetEffects = buildRemotionEffects(activeEffectsAt(effects, target.id, absoluteSeconds));
  const progress = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {extrapolateRight: 'clamp'});
  const peak = Math.sin(progress * Math.PI);
  const rotation = (media: MediaFile) => mediaTransformCss(media, composition);
  const sourceOpacity = (source.opacity ?? 100) / 100;
  const targetOpacity = (target.opacity ?? 100) / 100;
  const transitionZIndex = Math.max(source.zIndex ?? 0, target.zIndex ?? 0) + 1;
  let sourceStyle: React.CSSProperties = {opacity: (1 - progress) * sourceOpacity, transform: rotation(source)};
  let targetStyle: React.CSSProperties = {opacity: progress * targetOpacity, transform: rotation(target)};

  if (transition.type === 'wipe') {
    sourceStyle = {opacity: sourceOpacity, transform: rotation(source)};
    targetStyle = {opacity: targetOpacity, clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)`, transform: rotation(target)};
  } else if (transition.type === 'slide' || transition.type === 'push') {
    sourceStyle = {opacity: sourceOpacity, transform: `${rotation(source)} translateX(${-progress * 100}%)`};
    targetStyle = {opacity: targetOpacity, transform: `${rotation(target)} translateX(${(1 - progress) * 100}%)`};
  } else if (transition.type === 'whip-pan') {
    sourceStyle = {opacity: (1 - progress) * sourceOpacity, filter: `blur(${peak * 22}px)`, transform: `${rotation(source)} translateX(${-progress * 120}%)`};
    targetStyle = {opacity: progress * targetOpacity, filter: `blur(${peak * 22}px)`, transform: `${rotation(target)} translateX(${(1 - progress) * 120}%)`};
  } else if (transition.type === 'blur') {
    sourceStyle = {opacity: (1 - progress) * sourceOpacity, filter: `blur(${progress * 28}px)`, transform: rotation(source)};
    targetStyle = {opacity: progress * targetOpacity, filter: `blur(${(1 - progress) * 28}px)`, transform: rotation(target)};
  } else if (transition.type === 'zoom') {
    sourceStyle = {opacity: (1 - progress) * sourceOpacity, transform: `${rotation(source)} scale(${1 + progress * 0.18})`};
    targetStyle = {opacity: progress * targetOpacity, transform: `${rotation(target)} scale(${0.82 + progress * 0.18})`};
  }

  const halfFrames = Math.max(1, Math.floor(durationInFrames / 2));
  const secondHalfFrames = Math.max(1, durationInFrames - halfFrames);
  const sourceTailSeconds = (halfFrames / fps) * (source.playbackSpeed || 1);
  const sourceTrim = Math.max(source.startTime, source.endTime - sourceTailSeconds);
  const sourceLastFrame = Math.max(source.startTime, source.endTime - 1 / fps);
  const officialPresentation = isOfficialTransition(transition.type) ? officialPresentationFor(transition.type) : null;
  if (officialPresentation) {
    const sourceRotation: React.CSSProperties = {transform: rotation(source), opacity: sourceOpacity};
    const targetRotation: React.CSSProperties = {transform: rotation(target), opacity: targetOpacity};
    return (
      <AbsoluteFill style={{pointerEvents: 'none', zIndex: transitionZIndex}}>
        <TransitionSeries>
          <TransitionSeries.Sequence durationInFrames={durationInFrames}>
            <AbsoluteFill>
              <Sequence durationInFrames={halfFrames} layout="none"><TransitionAsset media={source} fps={fps} trimStart={sourceTrim} style={sourceRotation} effects={sourceEffects} composition={composition} /></Sequence>
              <Sequence from={halfFrames} durationInFrames={secondHalfFrames} layout="none"><Freeze frame={0}><TransitionAsset media={source} fps={fps} trimStart={sourceLastFrame} style={sourceRotation} effects={sourceEffects} composition={composition} /></Freeze></Sequence>
            </AbsoluteFill>
          </TransitionSeries.Sequence>
          <TransitionSeries.Transition presentation={officialPresentation} timing={linearTiming({durationInFrames})} />
          <TransitionSeries.Sequence durationInFrames={durationInFrames}>
            <AbsoluteFill>
              <Sequence durationInFrames={halfFrames} layout="none"><Freeze frame={0}><TransitionAsset media={target} fps={fps} trimStart={target.startTime} style={targetRotation} effects={targetEffects} composition={composition} /></Freeze></Sequence>
              <Sequence from={halfFrames} durationInFrames={secondHalfFrames} layout="none"><TransitionAsset media={target} fps={fps} trimStart={target.startTime} style={targetRotation} effects={targetEffects} composition={composition} /></Sequence>
            </AbsoluteFill>
          </TransitionSeries.Sequence>
        </TransitionSeries>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{pointerEvents: 'none', zIndex: transitionZIndex}}>
      <Sequence durationInFrames={halfFrames} layout="none"><TransitionAsset media={source} fps={fps} trimStart={sourceTrim} style={sourceStyle} effects={sourceEffects} composition={composition} /></Sequence>
      <Sequence from={halfFrames} durationInFrames={secondHalfFrames} layout="none"><Freeze frame={0}><TransitionAsset media={source} fps={fps} trimStart={sourceLastFrame} style={sourceStyle} effects={sourceEffects} composition={composition} /></Freeze></Sequence>
      <Sequence durationInFrames={halfFrames} layout="none"><Freeze frame={0}><TransitionAsset media={target} fps={fps} trimStart={target.startTime} style={targetStyle} effects={targetEffects} composition={composition} /></Freeze></Sequence>
      <Sequence from={halfFrames} durationInFrames={secondHalfFrames} layout="none"><TransitionAsset media={target} fps={fps} trimStart={target.startTime} style={targetStyle} effects={targetEffects} composition={composition} /></Sequence>
      {transition.type === 'flash' && <AbsoluteFill style={{backgroundColor: '#fff', opacity: peak}} />}
    </AbsoluteFill>
  );
};

export const ProjectComposition: React.FC<ProjectCompositionProps> = ({project}) => {
  const [fontHandle] = useState(() => delayRender('Loading Noto Sans KR caption font'));
  useEffect(() => {
    document.fonts.load('700 48px "Noto Sans KR Variable"')
      .then(() => continueRender(fontHandle))
      .catch((error) => cancelRender(error));
  }, [fontHandle]);
  const fps = project.fps || 30;
  const composition = project.resolution;
  return (
    <AbsoluteFill style={{backgroundColor: '#000', overflow: 'hidden'}}>
      {[...project.mediaFiles].filter((media) => media.includeInMerge !== false).sort((a, b) => a.zIndex - b.zIndex).map((media) => <MediaLayer key={media.id} media={media} fps={fps} effects={project.workflow.effects} composition={composition} />)}
      {project.textElements.filter((item) => item.includeInMerge !== false).map((item) => <TextLayer key={item.id} item={item} fps={fps} composition={composition} />)}
      {project.shapes.map((item) => <ShapeLayer key={item.id} item={item} fps={fps} composition={composition} />)}
      {project.exportSettings.includeSubtitles && project.workflow.captions.map((cue) => {
        const durationInFrames = Math.max(1, Math.round((cue.endSeconds - cue.startSeconds) * fps));
        return <Sequence key={cue.id} from={Math.round(cue.startSeconds * fps)} durationInFrames={durationInFrames} layout="none"><CaptionContent cue={cue} durationInFrames={durationInFrames} /></Sequence>;
      })}
      {project.workflow.transitions.map((transition) => {
        const source = project.mediaFiles.find((media) => media.id === transition.fromMediaId);
        const target = project.mediaFiles.find((media) => media.id === transition.toMediaId);
        if (!source || !target || source.includeInMerge === false || target.includeInMerge === false || transition.type === 'none') return null;
        const durationInFrames = Math.max(1, Math.round(transition.durationSeconds * fps));
        const boundary = Math.min(source.positionEnd, target.positionStart || source.positionEnd);
        const from = Math.max(0, Math.round((boundary - transition.durationSeconds / 2) * fps));
        return <Sequence key={transition.id} from={from} durationInFrames={durationInFrames} layout="none"><TransitionPairContent transition={transition} source={source} target={target} fps={fps} durationInFrames={durationInFrames} timelineStartSeconds={from / fps} effects={project.workflow.effects} composition={composition} /></Sequence>;
      })}
    </AbsoluteFill>
  );
};
