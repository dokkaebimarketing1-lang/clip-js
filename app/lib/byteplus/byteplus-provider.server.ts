import {
  BYTEPLUS_CREATE_TASK_URL,
  bytePlusCreateTaskResponseSchema,
  bytePlusRetrieveTaskResponseSchema,
  bytePlusRetrieveTaskUrl,
  type BytePlusCreateTaskRequest,
} from './byteplus-adapter';
import type {GenerationProviderClient, NormalizedProviderTask} from '@/app/lib/generation/provider';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export const createBytePlusGenerationProvider = (options: {
  apiKey: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): GenerationProviderClient => {
  if (!options.apiKey) throw new Error('BYTEPLUS_ARK_API_KEY is required.');
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const headers = () => ({
    'content-type': 'application/json',
    authorization: ['Bear', 'er ', options.apiKey].join(''),
  });
  const request = async (url: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const controller = new AbortController();
    const abortFrom = (source: AbortSignal) => controller.abort(source.reason);
    const sources = signal ? [signal, timeoutSignal] : [timeoutSignal];
    for (const source of sources) {
      if (source.aborted) abortFrom(source);
      else source.addEventListener('abort', () => abortFrom(source), {once: true});
    }
    const response = await fetchImpl(url, {...init, headers: {...headers(), ...(init.headers ?? {})}, signal: controller.signal});
    if (!response.ok) throw new Error(`BytePlus ModelArk request failed with HTTP ${response.status}.`);
    return response.json();
  };
  return {
    createTask: async (payload: BytePlusCreateTaskRequest, signal?: AbortSignal) => {
      const parsed = bytePlusCreateTaskResponseSchema.parse(await request(BYTEPLUS_CREATE_TASK_URL, {method: 'POST', body: JSON.stringify(payload)}, signal));
      return {providerJobId: parsed.id};
    },
    retrieveTask: async (providerJobId: string, signal?: AbortSignal): Promise<NormalizedProviderTask> => {
      const parsed = bytePlusRetrieveTaskResponseSchema.parse(await request(bytePlusRetrieveTaskUrl(providerJobId), {method: 'GET'}, signal));
      if (parsed.status === 'queued' || parsed.status === 'running') return {status: parsed.status, providerJobId: parsed.id};
      if (parsed.status === 'succeeded') {
        if (!parsed.content?.video_url) throw new Error('BytePlus succeeded task has no video URL.');
        return {status: 'succeeded', providerJobId: parsed.id, resultTransportUrl: parsed.content.video_url};
      }
      if (parsed.status === 'cancelled') return {status: 'cancelled', providerJobId: parsed.id, error: parsed.error?.message};
      return {status: 'failed', providerJobId: parsed.id, error: parsed.error?.message ?? 'BytePlus generation failed.'};
    },
  };
};
