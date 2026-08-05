/**
 * Covers how long a wake-up keeps looking for the request a code answers, and
 * — more importantly — when it stops. Every extra look risks spending one of
 * the bank's few attempts on an answer already known.
 */
import type { BackgroundSubmitOutcome } from './otpBackgroundSubmit';
import { TASK_BUDGET_MS } from './otpDeadline';
import {
  RETRY_INTERVAL_MS,
  RETRY_WINDOW_MS,
  type RetryableOutcome,
  type RetryPorts,
  retryUntilAnswered,
  worthRetrying,
} from './otpRetry';
import type { StashRunOutcome } from './otpStashRunner';

/**
 * Builds ports whose clock advances by exactly the waits that are asked for.
 *
 * Nothing here touches a real timer, so the twenty-second budget is spent in
 * whatever time the assertions take.
 *
 * @param outcomes - What each successive look returns; the last one repeats.
 * @returns The ports, alongside the mocks the test asserts on.
 */
function ports<T extends RetryableOutcome>(
  outcomes: T[],
): {
  readonly value: RetryPorts<T>;
  readonly attempt: jest.Mock<Promise<T>, []>;
  readonly waits: number[];
} {
  let clock = 1_000;
  const waits: number[] = [];
  let index = 0;
  const attempt = jest.fn<Promise<T>, []>().mockImplementation(() => {
    const outcome = outcomes[Math.min(index, outcomes.length - 1)];
    index += 1;
    return Promise.resolve(outcome);
  });
  return {
    attempt,
    waits,
    value: {
      attempt,
      now: () => clock,
      wait: (ms: number) => {
        waits.push(ms);
        clock += ms;
        return Promise.resolve();
      },
    },
  };
}

describe('worthRetrying', () => {
  it('keeps looking while no request has appeared', () => {
    // The bank sends the code because the scraper asked for it, so the message
    // routinely arrives before the request it answers exists.
    expect(worthRetrying('no-pending')).toBe(true);
  });

  it('keeps looking when the importer never judged the code', () => {
    expect(worthRetrying('failed')).toBe(true);
  });

  it.each<StashRunOutcome>(['submitted', 'rejected', 'empty', 'ambiguous', 'no-session'])(
    'stops on %s',
    (outcome) => {
      expect(worthRetrying(outcome)).toBe(false);
    },
  );

  it('stops when the user has a switch off', () => {
    // Looking again cannot turn a switch back on, and this runs unattended.
    expect(worthRetrying('not-allowed')).toBe(false);
  });

  it('stops when the message carried no code, however often it is read', () => {
    expect(worthRetrying('no-code')).toBe(false);
  });
});

describe('retryUntilAnswered', () => {
  it('looks once when the first answer is settled', async () => {
    const p = ports<StashRunOutcome>(['submitted']);
    await expect(retryUntilAnswered(p.value)).resolves.toBe('submitted');
    expect(p.attempt).toHaveBeenCalledTimes(1);
    expect(p.waits).toEqual([]);
  });

  it('looks again once the request appears', async () => {
    const p = ports<StashRunOutcome>(['no-pending', 'no-pending', 'submitted']);
    await expect(retryUntilAnswered(p.value)).resolves.toBe('submitted');
    expect(p.attempt).toHaveBeenCalledTimes(3);
    expect(p.waits).toEqual([RETRY_INTERVAL_MS, RETRY_INTERVAL_MS]);
  });

  it('gives up inside the window rather than on the edge of it', async () => {
    // An attempt starting *at* the deadline has no budget left to finish in, so
    // the last one starts before it — leaving no room for a further wait.
    const p = ports<StashRunOutcome>(['no-pending']);
    await expect(retryUntilAnswered(p.value)).resolves.toBe('no-pending');
    const spent = p.waits.reduce((total, ms) => total + ms, 0);
    expect(spent).toBeLessThan(RETRY_WINDOW_MS);
    expect(spent + RETRY_INTERVAL_MS).toBeGreaterThanOrEqual(RETRY_WINDOW_MS);
  });

  it('stops when the importer may already have taken the code', () => {
    // A send that threw was already on its way. Asking again could hand the bank
    // a second attempt at a code it has arguably already been given, and a bank
    // grants only a handful before it locks the request out.
    expect(worthRetrying('unknown')).toBe(false);
  });

  it('keeps the last look inside the budget the task gives itself', () => {
    // The window bounds when a look may start, not when it finishes, and the
    // calls underneath have no deadline of their own — so the budget has to be
    // the longer of the two. The budget's own ceiling is pinned beside it.
    expect(RETRY_WINDOW_MS).toBeLessThan(TASK_BUDGET_MS);
  });

  it('stops the moment a code is refused, without spending another attempt', async () => {
    const p = ports<StashRunOutcome>(['rejected', 'submitted']);
    await expect(retryUntilAnswered(p.value)).resolves.toBe('rejected');
    expect(p.attempt).toHaveBeenCalledTimes(1);
  });

  it('serves the direct-submit path on the same terms', async () => {
    // The path that already holds the body hits the same ordering problem, so
    // it retries through this too rather than dropping the code.
    const p = ports<BackgroundSubmitOutcome>(['no-pending', 'submitted']);
    await expect(retryUntilAnswered(p.value)).resolves.toBe('submitted');
    expect(p.attempt).toHaveBeenCalledTimes(2);
  });
});
