import {describe, expect, it} from 'vitest';
import {parseSrt} from './srt';

describe('parseSrt', () => {
  it('parses Korean captions with millisecond precision', () => {
    const cues = parseSrt('1\n00:00:01,250 --> 00:00:03,500\n먹을 것인가');
    expect(cues[0]).toMatchObject({text: '먹을 것인가', startSeconds: 1.25, endSeconds: 3.5});
  });

  it('rejects malformed caption blocks', () => {
    expect(() => parseSrt('1\nno timestamp\ntext')).toThrow(/timeline/);
  });
});
