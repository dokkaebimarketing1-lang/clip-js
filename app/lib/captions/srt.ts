import {parseSrt as parseRemotionSrt} from '@remotion/captions';
import type {CaptionCue} from '@/app/lib/workflow/schema';
import {buildWordTimings, CAPTION_FONT_FAMILY} from './caption-registry';

export const parseSrt = (source: string): CaptionCue[] => {
  const normalized = source.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  try {
    const {captions} = parseRemotionSrt({input: normalized});
    if (captions.length === 0) throw new Error('No captions');
    return captions.map((caption, index) => ({
      id: `caption-${index + 1}`,
      text: caption.text.trim(),
      startSeconds: caption.startMs / 1000,
      endSeconds: caption.endMs / 1000,
      kind: 'dialogue',
      preset: 'dialogue-clean',
      position: 'bottom',
      intensity: 0.5,
      accentColor: '#ffd43b',
      fontFamily: CAPTION_FONT_FAMILY,
      wordTimings: buildWordTimings(caption.text.trim(), caption.startMs, caption.endMs),
      emphasis: [],
      safeArea: true,
    }));
  } catch {
    throw new Error('Caption block has no valid timeline.');
  }
};
