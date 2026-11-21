import { createWriteQueue, serializeWrite, withOtpLane } from './writeQueue';

/**
 * Builds a promise the test can settle later.
 * @returns The promise and its resolver.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/**
 * Yields to the microtask queue and one macrotask, so queued writes have run.
 * @returns A promise that settles after the queue drains.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('serializeWrite', () => {
  it('does not start the next write before the first settles', async () => {
    const lane = createWriteQueue();
    const first = deferred<number>();
    const order: string[] = [];

    const a = serializeWrite(lane, async () => {
      order.push('a-start');
      const value = await first.promise;
      order.push('a-end');
      return value;
    });
    const b = serializeWrite(lane, async () => {
      order.push('b');
      return 2;
    });

    await settle();
    expect(order).toEqual(['a-start']);
    first.resolve(1);
    await expect(a).resolves.toBe(1);
    await expect(b).resolves.toBe(2);
    expect(order).toEqual(['a-start', 'a-end', 'b']);
  });

  it('runs the next write after the first rejects', async () => {
    const lane = createWriteQueue();

    const a = serializeWrite(lane, () => Promise.reject(new Error('write failed')));
    const b = serializeWrite(lane, () => Promise.resolve('ok'));

    await expect(a).rejects.toThrow('write failed');
    await expect(b).resolves.toBe('ok');
  });

  it('never blocks a different lane', async () => {
    const config = createWriteQueue();
    const devices = createWriteQueue();
    const pending = deferred<number>();

    const slow = serializeWrite(config, () => pending.promise);
    const fast = serializeWrite(devices, () => Promise.resolve('sent'));

    await expect(fast).resolves.toBe('sent');
    pending.resolve(1);
    await expect(slow).resolves.toBe(1);
  });
});

describe('withOtpLane', () => {
  it('serializes submissions for one request id', async () => {
    const first = deferred<number>();
    const order: string[] = [];

    const a = withOtpLane('request-1', async () => {
      order.push('a-start');
      const value = await first.promise;
      order.push('a-end');
      return value;
    });
    const b = withOtpLane('request-1', async () => {
      order.push('b');
      return 2;
    });

    await settle();
    expect(order).toEqual(['a-start']);
    first.resolve(1);
    await expect(a).resolves.toBe(1);
    await expect(b).resolves.toBe(2);
    expect(order).toEqual(['a-start', 'a-end', 'b']);
  });

  it('lets different request ids run independently', async () => {
    const pending = deferred<number>();

    const a = withOtpLane('request-1', () => pending.promise);
    const b = withOtpLane('request-2', () => Promise.resolve('sent'));

    await expect(b).resolves.toBe('sent');
    pending.resolve(1);
    await expect(a).resolves.toBe(1);
  });
});
