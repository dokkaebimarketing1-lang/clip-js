import {describe, expect, it, vi} from 'vitest';
import {createBytePlusGenerationProvider} from './byteplus-provider.server';
import {BYTEPLUS_CREATE_TASK_URL} from './byteplus-adapter';

const payload = {
  model: 'dreamina-seedance-2-5-260628' as const,
  content: [{type: 'text' as const, text: 'text-free video'}],
  generate_audio: false,
  ratio: '16:9' as const,
  duration: 30 as const,
  resolution: '720p' as const,
  watermark: false as const,
  return_last_frame: false as const,
};

describe('BytePlus provider client', () => {
  it('uses the official create/retrieve endpoints and normalizes success', async () => {
    const calls: Array<{url: string; init?: RequestInit}> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({url, init});
      if (init?.method === 'POST') return new Response(JSON.stringify({id: 'task-1'}), {status: 200});
      return new Response(JSON.stringify({id: 'task-1', model: 'dreamina-seedance-2-5-260628', status: 'succeeded', content: {video_url: 'https://result.example/video.mp4'}, usage: {completion_tokens: 1, total_tokens: 1}, created_at: 1, updated_at: 2}), {status: 200});
    });
    const provider = createBytePlusGenerationProvider({apiKey: 'test-secret', fetchImpl});
    expect(await provider.createTask(payload)).toEqual({providerJobId: 'task-1'});
    expect(await provider.retrieveTask('task-1')).toMatchObject({status: 'succeeded', resultTransportUrl: 'https://result.example/video.mp4'});
    expect(calls[0].url).toBe(BYTEPLUS_CREATE_TASK_URL);
    expect(calls[0].init?.method).toBe('POST');
    expect((calls[0].init?.headers as Record<string, string>).authorization).toBe(['Bear', 'er ', 'test-secret'].join(''));
    expect(calls[1].url).toBe(`${BYTEPLUS_CREATE_TASK_URL}/task-1`);
  });

  it('fails closed on undocumented response fields and HTTP errors without exposing the key', async () => {
    const extra = createBytePlusGenerationProvider({apiKey: 'secret-value', fetchImpl: async () => new Response(JSON.stringify({id: 'task-1', extra: true}), {status: 200})});
    await expect(extra.createTask(payload)).rejects.toBeDefined();
    const failed = createBytePlusGenerationProvider({apiKey: 'secret-value', fetchImpl: async () => new Response('hidden provider body', {status: 503})});
    await expect(failed.createTask(payload)).rejects.toThrow('HTTP 503');
    await expect(failed.createTask(payload)).rejects.not.toThrow('secret-value');
  });
});
