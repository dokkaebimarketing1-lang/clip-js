import type {BytePlusCreateTaskRequest} from '@/app/lib/byteplus/byteplus-adapter';

export type NormalizedProviderTask =
  | {status: 'queued' | 'running'; providerJobId: string}
  | {status: 'succeeded'; providerJobId: string; resultTransportUrl: string}
  | {status: 'failed'; providerJobId: string; error: string}
  | {status: 'cancelled' | 'expired'; providerJobId: string; error?: string};

export interface GenerationProviderClient {
  createTask(request: BytePlusCreateTaskRequest, signal?: AbortSignal): Promise<{providerJobId: string}>;
  retrieveTask(providerJobId: string, signal?: AbortSignal): Promise<NormalizedProviderTask>;
}

export class FakeGenerationProvider implements GenerationProviderClient {
  readonly submissions: BytePlusCreateTaskRequest[] = [];
  readonly polls: string[] = [];
  private readonly states = new Map<string, NormalizedProviderTask[]>();

  constructor(private readonly resultTransportUrl = 'https://results.example.com/fake-output.mp4') {}

  async createTask(request: BytePlusCreateTaskRequest): Promise<{providerJobId: string}> {
    this.submissions.push(structuredClone(request));
    const providerJobId = `fake-job-${this.submissions.length}`;
    this.states.set(providerJobId, [
      {status: 'running', providerJobId},
      {status: 'succeeded', providerJobId, resultTransportUrl: this.resultTransportUrl},
    ]);
    return {providerJobId};
  }

  async retrieveTask(providerJobId: string): Promise<NormalizedProviderTask> {
    this.polls.push(providerJobId);
    const states = this.states.get(providerJobId);
    if (!states?.length) throw new Error('Fake provider task not found.');
    return states.length > 1 ? states.shift()! : states[0];
  }
}
