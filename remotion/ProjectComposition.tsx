import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Freeze,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {Video} from '@remotion/media';
import {crossZoom, dreamyZoom, filmBurn, linearBlur, linearTiming, TransitionSeries, type TransitionPresentation} from '@remotion/transitions';
import {crosswarp} from '@remotion/transitions/crosswarp';
import {dissolve} from '@remotion/transitions/dissolve';
import {ripple} from '@remotion/transitions/ripple';
import type {EffectDescriptor} from 'remotion';
import type {MediaFile, ProjectState, TextElement} from '../app/types';
import type {CaptionCue, EffectSpec, TransitionSpec} from '../app/lib/workflow/schema';
import {activeEffectsAt, buildRemotionEffects} from './effects';
import {isOfficialTransition} from '../app/lib/workflow/transition-catalog';

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

const MediaLayer: React.FC<{media: MediaFile; fps: number; effects: readonly EffectSpec[]}> = ({media, fps, effects}) => {
  const frame = useCurrentFrame();
  const from = Math.max(0, Math.round(media.positionStart * fps));
  const durationInFrames = Math.max(1, Math.round((media.positionEnd - media.positionStart) * fps));
  const commonStyle: React.CSSProperties = {
    position: 'absolute',
    left: media.x ?? 0,
    top: media.y ?? 0,
    width: media.width ?? '100%',
    height: media.height ?? '100%',
    objectFit: 'cover',
    opacity: media.opacity === undefined ? 1 : media.opacity / 100,
    transform: `rotate(${media.rotation ?? 0}deg)`,
  };
  const source = mediaSource(media);
  if (!source) return null;
  const remotionEffects = buildRemotionEffects(activeEffectsAt(effects, media.id, frame / fps));
  return (
    <Sequence from={from} durationInFrames={durationInFrames} layout="none" name={media.fileName}>
      {media.type === 'video' ? (
        <Video
          src={source}
          trimBefore={Math.max(0, Math.round(media.startTime * fps))}
          trimAfter={Math.max(1, Math.round(media.endTime * fps))}
          playbackRate={media.playbackSpeed || 1}
          volume={(media.volume ?? 100) / 100}
          effects={remotionEffects}
          style={commonStyle}
        />
      ) : media.type === 'image' ? (
        <Img src={source} effects={remotionEffects} style={commonStyle} />
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

const TextLayer: React.FC<{item: TextElement; fps: number}> = ({item, fps}) => (
  <Sequence
    from={Math.round(item.positionStart * fps)}
    durationInFrames={Math.max(1, Math.round((item.positionEnd - item.positionStart) * fps))}
    layout="none"
  >
    <div style={{position: 'absolute', left: item.x, top: item.y, width: item.width ?? 1200, fontFamily: item.font ?? 'Arial', fontSize: item.fontSize ?? 64, color: item.color ?? '#fff', backgroundColor: item.backgroundColor ?? 'transparent', textAlign: item.align ?? 'center', opacity: (item.opacity ?? 100) / 100, whiteSpace: 'pre-wrap'}}>
      {item.text}
    </div>
  </Sequence>
);

const CaptionContent: React.FC<{cue: CaptionCue; durationInFrames: number}> = ({cue, durationInFrames}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const scale = cue.preset === 'shorts' ? interpolate(frame, [0, Math.min(6, durationInFrames)], [0.75, 1], {extrapolateRight: 'clamp'}) : 1;
  const words = cue.text.split(/(\s+)/);
  return (
    <div style={{position: 'absolute', left: width * 0.08, width: width * 0.84, bottom: height * 0.08, textAlign: 'center', fontFamily: 'Pretendard, Noto Sans KR, sans-serif', fontWeight: 800, fontSize: Math.max(38, width * 0.038), color: '#fff', textShadow: '0 3px 12px #000, 0 1px 2px #000', transform: `scale(${scale})`, lineHeight: 1.25}}>
      {words.map((word, index) => cue.emphasis.includes(word.trim()) ? <span key={index} style={{color: '#ffd43b'}}>{word}</span> : word)}
    </div>
  );
};

const TransitionAsset: React.FC<{media: MediaFile; fps: number; trimStart: number; style: React.CSSProperties; effects: EffectDescriptor<unknown>[]}> = ({media, fps, trimStart, style, effects}) => {
  const source = mediaSource(media);
  if (!source || media.type === 'audio') return null;
  const base: React.CSSProperties = {
    position: 'absolute', left: media.x ?? 0, top: media.y ?? 0,
    width: media.width ?? '100%', height: media.height ?? '100%', objectFit: 'cover',
    ...style,
  };
  return media.type === 'image'
    ? <Img src={source} effects={effects} style={base} />
    : <Video src={source} trimBefore={Math.max(0, Math.round(trimStart * fps))} playbackRate={media.playbackSpeed || 1} muted effects={effects} style={base} />;
};

const TransitionPairContent: React.FC<{transition: TransitionSpec; source: MediaFile; target: MediaFile; fps: number; durationInFrames: number; timelineStartSeconds: number; effects: readonly EffectSpec[]}> = ({transition, source, target, fps, durationInFrames, timelineStartSeconds, effects}) => {
  const frame = useCurrentFrame();
  const absoluteSeconds = timelineStartSeconds + frame / fps;
  const sourceEffects = buildRemotionEffects(activeEffectsAt(effects, source.id, absoluteSeconds));
  const targetEffects = buildRemotionEffects(activeEffectsAt(effects, target.id, absoluteSeconds));
  const progress = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {extrapolateRight: 'clamp'});
  const peak = Math.sin(progress * Math.PI);
  const rotation = (media: MediaFile) => `rotate(${media.rotation ?? 0}deg)`;
  let sourceStyle: React.CSSProperties = {opacity: 1 - progress, transform: rotation(source)};
  let targetStyle: React.CSSProperties = {opacity: progress, transform: rotation(target)};

  if (transition.type === 'wipe') {
    sourceStyle = {opacity: 1, transform: rotation(source)};
    targetStyle = {opacity: 1, clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)`, transform: rotation(target)};
  } else if (transition.type === 'slide' || transition.type === 'push') {
    sourceStyle = {opacity: 1, transform: `${rotation(source)} translateX(${-progress * 100}%)`};
    targetStyle = {opacity: 1, transform: `${rotation(target)} translateX(${(1 - progress) * 100}%)`};
  } else if (transition.type === 'whip-pan') {
    sourceStyle = {opacity: 1 - progress, filter: `blur(${peak * 22}px)`, transform: `${rotation(source)} translateX(${-progress * 120}%)`};
    targetStyle = {opacity: progress, filter: `blur(${peak * 22}px)`, transform: `${rotation(target)} translateX(${(1 - progress) * 120}%)`};
  } else if (transition.type === 'blur') {
    sourceStyle = {opacity: 1 - progress, filter: `blur(${progress * 28}px)`, transform: rotation(source)};
    targetStyle = {opacity: progress, filter: `blur(${(1 - progress) * 28}px)`, transform: rotation(target)};
  } else if (transition.type === 'zoom') {
    sourceStyle = {opacity: 1 - progress, transform: `${rotation(source)} scale(${1 + progress * 0.18})`};
    targetStyle = {opacity: progress, transform: `${rotation(target)} scale(${0.82 + progress * 0.18})`};
  }

  const halfFrames = Math.max(1, Math.floor(durationInFrames / 2));
  const secondHalfFrames = Math.max(1, durationInFrames - halfFrames);
  const sourceTailSeconds = (halfFrames / fps) * (source.playbackSpeed || 1);
  const sourceTrim = Math.max(source.startTime, source.endTime - sourceTailSeconds);
  const sourceLastFrame = Math.max(source.startTime, source.endTime - 1 / fps);
  const officialPresentation = isOfficialTransition(transition.type) ? officialPresentationFor(transition.type) : null;
  if (officialPresentation) {
    const sourceRotation: React.CSSProperties = {transform: rotation(source)};
    const targetRotation: React.CSSProperties = {transform: rotation(target)};
    return (
      <AbsoluteFill style={{pointerEvents: 'none'}}>
        <TransitionSeries>
          <TransitionSeries.Sequence durationInFrames={durationInFrames}>
            <AbsoluteFill>
              <Sequence durationInFrames={halfFrames} layout="none"><TransitionAsset media={source} fps={fps} trimStart={sourceTrim} style={sourceRotation} effects={sourceEffects} /></Sequence>
              <Sequence from={halfFrames} durationInFrames={secondHalfFrames} layout="none"><Freeze frame={0}><TransitionAsset media={source} fps={fps} trimStart={sourceLastFrame} style={sourceRotation} effects={sourceEffects} /></Freeze></Sequence>
            </AbsoluteFill>
          </TransitionSeries.Sequence>
          <TransitionSeries.Transition presentation={officialPresentation} timing={linearTiming({durationInFrames})} />
          <TransitionSeries.Sequence durationInFrames={durationInFrames}>
            <AbsoluteFill>
              <Sequence durationInFrames={halfFrames} layout="none"><Freeze frame={0}><TransitionAsset media={target} fps={fps} trimStart={target.startTime} style={targetRotation} effects={targetEffects} /></Freeze></Sequence>
              <Sequence from={halfFrames} durationInFrames={secondHalfFrames} layout="none"><TransitionAsset media={target} fps={fps} trimStart={target.startTime} style={targetRotation} effects={targetEffects} /></Sequence>
            </AbsoluteFill>
          </TransitionSeries.Sequence>
        </TransitionSeries>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <Sequence durationInFrames={halfFrames} layout="none"><TransitionAsset media={source} fps={fps} trimStart={sourceTrim} style={sourceStyle} effects={sourceEffects} /></Sequence>
      <Sequence from={halfFrames} durationInFrames={secondHalfFrames} layout="none"><Freeze frame={0}><TransitionAsset media={source} fps={fps} trimStart={sourceLastFrame} style={sourceStyle} effects={sourceEffects} /></Freeze></Sequence>
      <Sequence durationInFrames={halfFrames} layout="none"><Freeze frame={0}><TransitionAsset media={target} fps={fps} trimStart={target.startTime} style={targetStyle} effects={targetEffects} /></Freeze></Sequence>
      <Sequence from={halfFrames} durationInFrames={secondHalfFrames} layout="none"><TransitionAsset media={target} fps={fps} trimStart={target.startTime} style={targetStyle} effects={targetEffects} /></Sequence>
      {transition.type === 'flash' && <AbsoluteFill style={{backgroundColor: '#fff', opacity: peak}} />}
    </AbsoluteFill>
  );
};

export const ProjectComposition: React.FC<ProjectCompositionProps> = ({project}) => {
  const fps = project.fps || 30;
  return (
    <AbsoluteFill style={{backgroundColor: '#000', overflow: 'hidden'}}>
      {[...project.mediaFiles].sort((a, b) => a.zIndex - b.zIndex).map((media) => <MediaLayer key={media.id} media={media} fps={fps} effects={project.workflow.effects} />)}
      {project.textElements.map((item) => <TextLayer key={item.id} item={item} fps={fps} />)}
      {project.exportSettings.includeSubtitles && project.workflow.captions.map((cue) => {
        const durationInFrames = Math.max(1, Math.round((cue.endSeconds - cue.startSeconds) * fps));
        return <Sequence key={cue.id} from={Math.round(cue.startSeconds * fps)} durationInFrames={durationInFrames} layout="none"><CaptionContent cue={cue} durationInFrames={durationInFrames} /></Sequence>;
      })}
      {project.workflow.transitions.map((transition) => {
        const source = project.mediaFiles.find((media) => media.id === transition.fromMediaId);
        const target = project.mediaFiles.find((media) => media.id === transition.toMediaId);
        if (!source || !target || transition.type === 'none') return null;
        const durationInFrames = Math.max(1, Math.round(transition.durationSeconds * fps));
        const boundary = Math.min(source.positionEnd, target.positionStart || source.positionEnd);
        const from = Math.max(0, Math.round((boundary - transition.durationSeconds / 2) * fps));
        return <Sequence key={transition.id} from={from} durationInFrames={durationInFrames} layout="none"><TransitionPairContent transition={transition} source={source} target={target} fps={fps} durationInFrames={durationInFrames} timelineStartSeconds={from / fps} effects={project.workflow.effects} /></Sequence>;
      })}
    </AbsoluteFill>
  );
};
