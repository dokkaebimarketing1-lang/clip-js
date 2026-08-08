import {describe, expect, it, vi} from 'vitest';
import {createSerialTaskQueue} from './serial-task-queue';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, resolve, reject};
};

describe('createSerialTaskQueue', () => {
  it('never overlaps queued work', async () => {
    const queue = createSerialTaskQueue(3, 'full');
    const first = deferred<string>();
    const secondTask = vi.fn(async () => 'second');

    const firstJob = queue(() => first.promise);
    const secondJob = queue(secondTask);
    await Promise.resolve();
    expect(secondTask).not.toHaveBeenCalled();

    first.resolve('first');
    await expect(firstJob).resolves.toBe('first');
    await expect(secondJob).resolves.toBe('second');
  });

  it('rejects excess work instead of growing without bound', async () => {
    const queue = createSerialTaskQueue(1, 'Render queue is full.');
    const first = deferred<string>();
    const firstJob = queue(() => first.promise);

    await expect(queue(async () => 'second')).rejects.toThrow('Render queue is full.');
    first.resolve('first');
    await expect(firstJob).resolves.toBe('first');
    await expect(queue(async () => 'after')).resolves.toBe('after');
  });

  it('continues after a task failure', async () => {
    const queue = createSerialTaskQueue(2, 'full');
    await expect(queue(async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    await expect(queue(async () => 'recovered')).resolves.toBe('recovered');
  });
});
