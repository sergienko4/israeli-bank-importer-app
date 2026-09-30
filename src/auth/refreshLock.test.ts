/**
 * Proves renewals run one at a time, which is what keeps a single-use refresh
 * token from being presented twice.
 */
import { withRefreshLock } from './refreshLock';

describe('withRefreshLock', () => {
  it('runs overlapping work one after another, in call order', async () => {
    const events: string[] = [];
    let release: () => void = () => undefined;
    const first = withRefreshLock(async () => {
      events.push('first:start');
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      events.push('first:end');
    });
    const second = withRefreshLock(() => {
      events.push('second:start');
      return Promise.resolve();
    });
    await Promise.resolve();
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('hands a failure to its own caller without blocking the next one', async () => {
    const failed = withRefreshLock(() =>
      Promise.reject(new Error('The importer did not respond in time.')),
    );
    const next = withRefreshLock(() => Promise.resolve('renewed'));
    await expect(failed).rejects.toThrow('did not respond');
    await expect(next).resolves.toBe('renewed');
  });
});
