const timeoutError = (ms: number, label: string): Error =>
  new Error(`Render step timed out after ${ms / 1000}s (${label}).`);

export const withTimeout = <T>(
  operation: Promise<T>,
  ms: number,
  label: string,
  onTimeout: () => void = () => undefined,
): Promise<T> => new Promise<T>((resolve, reject) => {
  let completed = false;
  let didTimeout = false;

  const finish = (callback: () => void): void => {
    if (completed) return;
    completed = true;
    clearTimeout(timeoutTimer);
    callback();
  };

  const timeoutTimer = setTimeout(() => {
    if (completed) return;
    didTimeout = true;
    try {
      onTimeout();
    } catch {
      // Keep the operation pending: releasing the queue before termination would break serialization.
    }
  }, ms);

  operation.then(
    (value) => finish(() => didTimeout ? reject(timeoutError(ms, label)) : resolve(value)),
    (error) => finish(() => didTimeout ? reject(timeoutError(ms, label)) : reject(error)),
  );
});
