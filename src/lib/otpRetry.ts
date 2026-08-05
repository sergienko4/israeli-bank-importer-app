/**
 * Keeps looking for the request that a captured code answers, for a short while.
 *
 * The bank sends its code *because* the scraper asked the bank for it, so the
 * message routinely arrives before the importer has finished raising the
 * request it answers. When the app is closed the arriving message is the only
 * thing that starts this process at all, so giving up after one look would
 * strand the code until the user next opened the app — which is the behaviour
 * this exists to remove.
 *
 * It is deliberately indifferent to *what* is being attempted. Both wake-up
 * paths hit the same ordering problem: one holds the message and drains it, the
 * other has the body in hand and submits it directly, and neither should stop at
 * the first "nothing is waiting yet".
 */
import type { BackgroundSubmitOutcome } from './otpBackgroundSubmit';
import type { StashRunOutcome } from './otpStashRunner';

/** How long to keep starting new looks. */
export const RETRY_WINDOW_MS = 20_000;

/** How long to wait between looks. */
export const RETRY_INTERVAL_MS = 2_500;

/** Every reason either wake-up path stops, so one retry serves both. */
export type RetryableOutcome = StashRunOutcome | BackgroundSubmitOutcome;

/** What the retry needs from outside, injected so it runs without a device. */
export interface RetryPorts<T extends RetryableOutcome> {
  /** One look: spends the code if a request is waiting for it. */
  readonly attempt: () => Promise<T>;
  /** Waits the given number of milliseconds. */
  readonly wait: (ms: number) => Promise<void>;
  /** The current time, injected so the budget is testable. */
  readonly now: () => number;
}

/**
 * Whether another look could plausibly reach a different answer.
 *
 * `no-pending` is the ordering this exists for: the request may still be on its
 * way. `failed` is a read that never reached the importer, or a send the
 * importer answered without judging, which either way leaves the code unspent.
 * Every other outcome is settled — the code was sent, judged, was never there,
 * or *may* have been taken with only the answer lost — and asking again could
 * only spend one of the bank's few attempts on an answer already known.
 *
 * @param outcome - What the last look decided.
 * @returns True when another attempt is worth making.
 */
export function worthRetrying(outcome: RetryableOutcome): boolean {
  return outcome === 'no-pending' || outcome === 'failed';
}

/**
 * Looks, then keeps looking until the answer settles or the budget runs out.
 *
 * @param ports - The injected attempt, clock and delay.
 * @returns The last outcome reached.
 */
export async function retryUntilAnswered<T extends RetryableOutcome>(
  ports: RetryPorts<T>,
): Promise<T> {
  return attempt(ports, ports.now() + RETRY_WINDOW_MS);
}

/**
 * Makes one attempt, and schedules another if there is both reason and room.
 *
 * The budget is checked before sleeping rather than after, so the last attempt
 * always starts inside the window instead of just outside it.
 *
 * @param ports - The injected attempt, clock and delay.
 * @param deadline - The moment past which no further attempt may start.
 * @returns The last outcome reached.
 */
async function attempt<T extends RetryableOutcome>(
  ports: RetryPorts<T>,
  deadline: number,
): Promise<T> {
  const outcome = await ports.attempt();
  if (!worthRetrying(outcome) || ports.now() + RETRY_INTERVAL_MS >= deadline) {
    return outcome;
  }
  await ports.wait(RETRY_INTERVAL_MS);
  return attempt(ports, deadline);
}
