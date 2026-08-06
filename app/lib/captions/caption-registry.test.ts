import {describe, expect, it} from 'vitest';
import {buildWordTimings, CAPTION_CATALOG, isCaptionPresetAllowedForKind} from './caption-registry';
import {captionCueSchema} from '../workflow/schema';

describe('Caption Registry', () => {
  it('builds deterministic Korean word timings across the cue range', () => {
    expect(buildWordTimings('이게 정말 된다고', 1000, 2500)).toEqual([
      {text: '이게', startMs: 1000, endMs: 1500},
      {text: '정말', startMs: 1500, endMs: 2000},
      {text: '된다고', startMs: 2000, endMs: 2500},
    ]);
  });

  it('keeps every catalog preset within its declared kind', () => {
    expect(CAPTION_CATALOG.length).toBe(16);
    for (const entry of CAPTION_CATALOG) {
      expect(isCaptionPresetAllowedForKind(entry.preset, entry.kind)).toBe(true);
      expect(() => captionCueSchema.parse({id: entry.preset, text: '검증', startSeconds: 0, endSeconds: 1, kind: entry.kind, preset: entry.preset})).not.toThrow();
    }
    expect(isCaptionPresetAllowedForKind('variety-shock', 'dialogue')).toBe(false);
    expect(() => captionCueSchema.parse({id: 'bad', text: '잘못된 조합', startSeconds: 0, endSeconds: 1, kind: 'dialogue', preset: 'variety-shock'})).toThrow(/not allowed/);
  });
});
