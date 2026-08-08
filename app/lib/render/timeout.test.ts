import {afterEach, describe, expect, it, vi} from 'vitest';
import {withTimeout} from './timeout';

afterEach(() => {
  vi.useRealTimers();
});

describe('withTimeout', () => {
  it('runs cancellation before rejecting a timed-out operation', async () => {
    vi.useFakeTimers();
    let rejectOperation: (error: Error) => void = () => undefined;
    const operation = new Promise<string>((_resolve, reject) => { rejectOperation = reject; });
    const cancel = vi.fn(() => rejectOperation(new Error('cancelled')));
    const result = withTimeout(operation, 100, 'renderMedia', cancel);

    const rejection = expect(result).rejects.toThrow('timed out after 0.1s (renderMedia)');
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('does not report completion or release the caller while cancellation is still unsettled', async () => {
    vi.useFakeTimers();
    let rejectOperation: (error: Error) => void = () => undefined;
    const operation = new Promise<string>((_resolve, reject) => { rejectOperation = reject; });
    let settled = false;
    const result = withTimeout(operation, 100, 'renderMedia', () => undefined);
    void result.finally(() => { settled = true; }).catch(() => undefined);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(settled).toBe(false);
    rejectOperation(new Error('renderer terminated'));
    await expect(result).rejects.toThrow('timed out after 0.1s (renderMedia)');
  });

  it('clears the timer after a successful operation', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();

    await expect(withTimeout(Promise.resolve('done'), 100, 'renderMedia', cancel)).resolves.toBe('done');
    await vi.advanceTimersByTimeAsync(100);
    expect(cancel).not.toHaveBeenCalled();
  });
});