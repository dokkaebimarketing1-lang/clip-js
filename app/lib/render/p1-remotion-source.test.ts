import {describe, expect, it} from 'vitest';
import {initialState} from '@/app/store/slices/projectSlice';
import {parseRenderProjectRequest} from '@/app/lib/workflow/project-file';

describe('P1 Remotion render source', () => {
  it('keeps only the selected take in merge inputs and preserves managed asset identity', () => {
    const project = structuredClone(initialState);
    project.id = 'p1-render';
    project.projectName = 'P1 render';
    project.duration = 5;
    project.mediaFiles = [
      {id: 'take-a', fileName: 'a.mp4', type: 'video', source: {kind: 'generated', generatedAssetId: `ga_${'a'.repeat(32)}`}, generatedAssetId: `ga_${'a'.repeat(32)}`, takeId: 'take-a', contentSha256: 'b'.repeat(64), startTime: 0, endTime: 5, positionStart: 0, positionEnd: 5, includeInMerge: false, playbackSpeed: 1, volume: 100, opacity: 1, zIndex: 1},
      {id: 'take-b', fileName: 'b.mp4', type: 'video', source: {kind: 'generated', generatedAssetId: `ga_${'c'.repeat(32)}`}, generatedAssetId: `ga_${'c'.repeat(32)}`, takeId: 'take-b', contentSha256: 'd'.repeat(64), startTime: 0, endTime: 5, positionStart: 0, positionEnd: 5, includeInMerge: true, playbackSpeed: 1, volume: 100, opacity: 1, zIndex: 1},
    ];
    const parsed = parseRenderProjectRequest({project});
    expect(parsed.mediaFiles.filter((media) => media.includeInMerge).map((media) => media.takeId)).toEqual(['take-b']);
    expect(parsed.mediaFiles[1].source).toEqual({kind: 'generated', generatedAssetId: `ga_${'c'.repeat(32)}`});
  });
});
