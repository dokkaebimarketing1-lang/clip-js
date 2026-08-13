import {describe, expect, it, vi} from 'vitest';
import {editCutWithDeepSeek} from './deepseek-cut-editor.server';

const cut = {id: 'CUT01', title: '기존 장면', absoluteStartSeconds: 0, absoluteEndSeconds: 5, shots: [{id: 'S1', startSeconds: 0, endSeconds: 5, startFrame: '기존 시작', endFrame: '기존 끝', camera: '고정', action: '걷는다', dialogue: '안녕', sfx: 'room'}]};

describe('DeepSeek cut editor', () => {
  it('uses the pinned planning model and preserves dialogue while applying structured edits', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({choices: [{message: {content: JSON.stringify({title: '수정 장면', action: '천천히 돌아본다', startFrame: '창가를 본다', endFrame: '카메라를 본다', camera: '느린 돌리 인'})}}]}), {status: 200}));
    const result = await editCutWithDeepSeek({cut, instruction: '더 따뜻하게 수정해줘', apiKey: 'test', fetchImpl});
    expect(result).toMatchObject({title: '수정 장면', shots: [{dialogue: '안녕', action: '천천히 돌아본다'}]});
    const calls = fetchImpl.mock.calls as unknown as Array<[string | URL | Request, RequestInit | undefined]>;
    const body = JSON.parse(String(calls[0][1]?.body));
    expect(body.model).toBe('deepseek-v4-flash-ga-260731');
    expect(body.thinking).toEqual({type: 'disabled'});
  });

  it('fails closed on malformed model output', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({choices: [{message: {content: '{}'}}]}), {status: 200}));
    await expect(editCutWithDeepSeek({cut, instruction: '수정', apiKey: 'test', fetchImpl})).rejects.toThrow();
  });
});
