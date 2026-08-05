/**
 * Covers the ceiling put on work that has no deadline of its own.
 *
 * Both callers are ends of the line — a headless task that must return so the
 * wake lock is released, and a lock that must be released so later drains can
 * run — so the two properties that matter are that waiting always stops and
 * that nothing is ever thrown back at them.
 */
import {
  ACK_MARGIN_MS,
  MIN_SEND_MS,
  settleWithin,
  SUBMIT_DEADLINE_MS,
  TASK_BUDGET_MS,
  TASK_TIMEOUT_MS,
} from './otpDeadline';

describe('settleWithin', () => {
  it('returns as soon as the work does', async () => {
    await expect(settleWithin(Promise.resolve('done'), TASK_BUDGET_MS)).resolves.toBeUndefined();
  });

  it('stops waiting once the deadline passes', async () => {
    jest.useFakeTimers();
    try {
      const settled = jest.fn();
      const waiting = settleWithin(new Promise(() => undefined), TASK_BUDGET_MS).then(settled);

      await jest.advanceTimersByTimeAsync(TASK_BUDGET_MS);

      await waiting;
      expect(settled).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('contains a rejection instead of passing it on', async () => {
    // React Native is never told that a rejected task has finished, so it holds
    // the wake lock until Android's own timeout instead of releasing it.
    await expect(
      settleWithin(Promise.reject(new Error('offline')), TASK_BUDGET_MS),
    ).resolves.toBeUndefined();
  });

  it('drops its timer once the work is done', async () => {
    // A timer left running keeps the JavaScript thread scheduled, which on this
    // path means keeping a device awake for no reason.
    jest.useFakeTimers();
    try {
      await settleWithin(Promise.resolve(), TASK_BUDGET_MS);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('gives the task room to return before Android stops waiting for it', () => {
    expect(TASK_BUDGET_MS).toBeLessThan(TASK_TIMEOUT_MS);
  });

  it('gives an abandoned send room to mark its code spent before the lock frees', () => {
    // The serial lock is what stops two drains offering the same held message.
    // A send still waiting when the lock frees would let the next drain send
    // the same code, so a send that starts the moment the run does has to give
    // up with the margin still to spare. A run that starts its send later has
    // less than a full budget left, and derives its deadline from what remains.
    expect(SUBMIT_DEADLINE_MS + ACK_MARGIN_MS).toBeLessThanOrEqual(TASK_BUDGET_MS);
  });

  it('leaves a run that starts promptly enough room to attempt a send at all', () => {
    // A send is refused below the floor, so a floor set too close to the budget
    // would refuse every send and silently turn auto-read off.
    expect(MIN_SEND_MS + ACK_MARGIN_MS).toBeLessThan(TASK_BUDGET_MS);
  });
});
