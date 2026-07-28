import { isOverviewTimeout, withOverviewTimeout } from './overviewTimeout';

function pendingPromise<T>(): Promise<T> {
  return new Promise<T>((resolve) => {
    void resolve;
  });
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('withOverviewTimeout', () => {
  it('resolves when the overview request finishes before the timeout', async () => {
    await expect(withOverviewTimeout(Promise.resolve('ready'))).resolves.toBe('ready');
  });

  it('rejects when the overview request hangs', async () => {
    const result = withOverviewTimeout(pendingPromise<string>());

    jest.advanceTimersByTime(10_000);

    await expect(result).rejects.toThrow('Overview refresh timed out.');
  });
});

describe('isOverviewTimeout', () => {
  it('identifies the overview timeout error', async () => {
    const result = withOverviewTimeout(pendingPromise<string>());

    jest.advanceTimersByTime(10_000);

    await result.then(
      () => {
        throw new Error('Expected overview timeout.');
      },
      (error: unknown) => {
        expect(isOverviewTimeout(error)).toBe(true);
      },
    );
  });
});
