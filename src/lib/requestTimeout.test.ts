import {
  isRequestTimeout,
  REQUEST_TIMEOUT_MESSAGE,
  RequestTimeoutError,
  withRequestTimeout,
} from './requestTimeout';

describe('withRequestTimeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns a result that arrives before the deadline', async () => {
    await expect(withRequestTimeout(Promise.resolve('done'), 1_000)).resolves.toBe('done');
  });

  it('rejects with a typed error when the deadline wins', async () => {
    const never = new Promise<never>(() => undefined);
    const result = withRequestTimeout(never, 1_000);
    const assertion = expect(result).rejects.toBeInstanceOf(RequestTimeoutError);

    jest.advanceTimersByTime(1_000);

    await assertion;
  });

  it('uses a message a screen can show directly', async () => {
    const never = new Promise<never>(() => undefined);
    const result = withRequestTimeout(never, 10);
    const assertion = expect(result).rejects.toThrow(REQUEST_TIMEOUT_MESSAGE);

    jest.advanceTimersByTime(10);

    await assertion;
  });

  it('preserves the original rejection', async () => {
    await expect(
      withRequestTimeout(Promise.reject(new Error('network down')), 1_000),
    ).rejects.toThrow('network down');
  });

  it('clears its timer when the operation finishes first', async () => {
    await withRequestTimeout(Promise.resolve('done'), 1_000);

    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('isRequestTimeout', () => {
  it('recognises its own error', () => {
    expect(isRequestTimeout(new RequestTimeoutError())).toBe(true);
  });

  it('does not treat another error as a timeout', () => {
    expect(isRequestTimeout(new Error(REQUEST_TIMEOUT_MESSAGE))).toBe(false);
    expect(isRequestTimeout('timeout')).toBe(false);
  });
});
