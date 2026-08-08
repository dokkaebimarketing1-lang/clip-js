export type SerialTaskQueue = <T>(task: () => Promise<T>) => Promise<T>;

export const createSerialTaskQueue = (maxPending: number, fullMessage: string): SerialTaskQueue => {
  if (!Number.isInteger(maxPending) || maxPending < 1) throw new Error('maxPending must be a positive integer.');

  let pending = 0;
  let tail: Promise<void> = Promise.resolve();

  return <T>(task: () => Promise<T>): Promise<T> => {
    if (pending >= maxPending) return Promise.reject(new Error(fullMessage));
    pending += 1;

    const job = tail.then(task);
    const tracked = job.finally(() => {
      pending -= 1;
    });
    tail = tracked.then(() => undefined, () => undefined);
    return tracked;
  };
};
