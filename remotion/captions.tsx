import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {CaptionCue, CaptionPosition} from '../app/lib/workflow/schema';

const placement = (position: CaptionPosition, height: number): React.CSSProperties => {
  if (position === 'top') return {top: height * 0.08};
  if (position === 'center') return {top: '50%', transform: 'translateY(-50%)'};
  if (position === 'lower-third') return {bottom: height * 0.16};
  return {bottom: height * 0.08};
};

export const captionStackStyle = (hasSpeaker: boolean, height: number): React.CSSProperties => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  rowGap: hasSpeaker ? Math.max(10, height * 0.014) : 0,
});

const presetStyle = (cue: CaptionCue, frame: number, fps: number): React.CSSProperties => {
  const strength = cue.intensity;
  const entry = spring({frame, fps, config: {damping: 13, stiffness: 180}});
  const shake = Math.sin(frame * 2.4) * 7 * strength;
  const style: React.CSSProperties = {};
  if (['shorts', 'bounce', 'impact', 'variety-shock'].includes(cue.preset)) {
    style.transform = `scale(${interpolate(entry, [0, 1], [0.68, 1])}) rotate(${cue.preset === 'variety-shock' ? shake : 0}deg)`;
  }
  if (cue.preset === 'variety-shake') style.transform = `translate(${shake}px, ${Math.cos(frame * 1.9) * 4 * strength}px)`;
  if (cue.preset === 'glow') style.textShadow = `0 0 ${16 + strength * 26}px ${cue.accentColor}, 0 4px 8px #000`;
  if (cue.preset === 'variety-sticker') Object.assign(style, {background: cue.accentColor, color: '#111', border: '6px solid #fff', borderRadius: 22, padding: '14px 28px', boxShadow: '8px 10px 0 #111', transform: 'rotate(-2deg)'});
  if (cue.preset === 'thought') Object.assign(style, {background: 'rgba(255,255,255,.94)', color: '#171717', borderRadius: 36, padding: '18px 34px', border: '4px solid #171717'});
  if (cue.preset === 'name-tag') Object.assign(style, {background: '#111', borderLeft: `12px solid ${cue.accentColor}`, padding: '14px 28px', textAlign: 'left'});
  if (cue.preset === 'quote-card') Object.assign(style, {background: 'rgba(0,0,0,.72)', borderTop: `5px solid ${cue.accentColor}`, borderBottom: `5px solid ${cue.accentColor}`, padding: '22px 36px'});
  return style;
};

export const CaptionContent: React.FC<{cue: CaptionCue; durationInFrames: number}> = ({cue, durationInFrames}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const absoluteMs = cue.startSeconds * 1000 + frame / fps * 1000;
  const activeWord = cue.wordTimings.findIndex((word) => absoluteMs >= word.startMs && absoluteMs < word.endMs);
  const words = cue.wordTimings.length > 0 ? cue.wordTimings : [{text: cue.text, startMs: cue.startSeconds * 1000, endMs: cue.endSeconds * 1000}];
  const typewriterLength = Math.ceil(interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, cue.text.length], {extrapolateRight: 'clamp'}));
  const animatedWords = ['word-highlight', 'karaoke', 'bounce', 'glow'].includes(cue.preset);

  return (
    <div style={{position: 'absolute', left: width * 0.07, width: width * 0.86, textAlign: 'center', ...captionStackStyle(Boolean(cue.speaker), height), ...placement(cue.position, height)}}>
      {cue.speaker && <div style={{display: 'block', padding: '5px 14px', borderRadius: 8, background: cue.accentColor, color: '#111', fontFamily: cue.fontFamily, fontWeight: 800, fontSize: Math.max(22, width * 0.018)}}>{cue.speaker}</div>}
      <div style={{display: 'block', width: 'fit-content', maxWidth: '100%', fontFamily: cue.fontFamily, fontWeight: cue.kind === 'dialogue' ? 750 : 900, fontSize: Math.max(38, width * (cue.kind === 'variety' ? 0.052 : 0.04)), lineHeight: 1.25, color: '#fff', overflowWrap: 'break-word', wordBreak: 'keep-all', WebkitTextStroke: cue.kind === 'variety' ? '2px #111' : undefined, paintOrder: 'stroke fill', textShadow: '0 4px 12px #000, 0 2px 3px #000', ...presetStyle(cue, frame, fps)}}>
        {cue.preset === 'typewriter' ? cue.text.slice(0, typewriterLength) : animatedWords ? words.map((word, index) => {
          const active = index === activeWord;
          const bounce = cue.preset === 'bounce' && active ? spring({frame: Math.max(0, frame - Math.round((word.startMs - cue.startSeconds * 1000) / 1000 * fps)), fps, config: {damping: 9}}) : 1;
          return <span key={`${word.startMs}-${index}`} style={{display: 'inline-block', marginRight: index === words.length - 1 ? 0 : '0.28em', color: active ? cue.accentColor : '#fff', opacity: cue.preset === 'karaoke' && index > activeWord ? 0.48 : 1, transform: `scale(${bounce})`, textShadow: cue.preset === 'glow' && active ? `0 0 24px ${cue.accentColor}` : undefined}}>{word.text}</span>;
        }) : cue.emphasis.length > 0 ? cue.text.split(/(\s+)/).map((word, index) => cue.emphasis.includes(word.trim()) ? <span key={index} style={{color: cue.accentColor}}>{word}</span> : word) : cue.text}
      </div>
    </div>
  );
};
