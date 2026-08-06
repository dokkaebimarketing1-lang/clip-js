import type {CaptionCue} from '@/app/lib/workflow/schema';

const timeToMs = (value: string): number => {
  const match = value.trim().match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match) throw new Error(`Invalid SRT timestamp: ${value}`);
  const [, hours, minutes, seconds, millis] = match;
  return (((Number(hours) * 60 + Number(minutes)) * 60) + Number(seconds)) * 1000 + Number(millis);
};

export const parseSrt = (source: string): CaptionCue[] => {
  const normalized = source.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  return normalized.split(/\n{2,}/).map((block, index) => {
    const lines = block.split('\n');
    const timeLineIndex = lines.findIndex((line) => line.includes('-->'));
    if (timeLineIndex < 0) throw new Error(`Caption block ${index + 1} has no timeline.`);
    const [start, end] = lines[timeLineIndex].split('-->').map((value) => value.trim());
    const text = lines.slice(timeLineIndex + 1).join('\n').trim();
    if (!text) throw new Error(`Caption block ${index + 1} has no text.`);
    return {
      id: `caption-${index + 1}`,
      text,
      startSeconds: timeToMs(start) / 1000,
      endSeconds: timeToMs(end) / 1000,
      preset: 'bold-highlight' as const,
      emphasis: text.match(/[가-힣A-Za-z0-9]+/g)?.slice(-1) ?? [],
      safeArea: true,
    };
  });
};
