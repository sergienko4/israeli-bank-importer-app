/**
 * Runs the stash drain behind the same switches as the rest of the feature.
 *
 * A held message was captured before anything asked for it, so the user may
 * have changed their mind in between. The switches are therefore read at the
 * moment of use rather than trusted from whenever the message arrived, and a
 * failure to read them refuses the drain: this runs on a poll tick with no
 * screen attached, so there is nowhere to report a problem and nothing lost by
 * leaving the code to be typed.
 */
import { getPendingOtp, submitOtp } from '../api/importerClient';
import { loadConnection } from '../auth/connectionStore';
import { loadBackgroundCaptureAllowed } from './otpBackgroundGate';
import { backgroundSession } from './otpBackgroundSession';
import { settleWithin, TASK_BUDGET_MS } from './otpDeadline';
import { drainStash, type StashDrainOutcome } from './otpStashDrain';
import { stash } from './otpStashSource';

/** What the runner needs, injected so the gate can be tested without a device. */
export interface StashRunnerPorts {
  /** Whether both switches are currently on. */
  readonly isAllowed: () => Promise<boolean>;
  /** Spends at most one held message. */
  readonly drain: () => Promise<StashDrainOutcome>;
}

/** The drain's own outcomes, plus the one the gate adds. */
export type StashRunOutcome = StashDrainOutcome | 'not-allowed';

/**
 * Drains held messages if, and only if, the user still allows it.
 *
 * @param ports - The injected gate and drain.
 * @returns What the drain decided, or `not-allowed` when it never ran.
 */
export async function runStashDrain(ports: StashRunnerPorts): Promise<StashRunOutcome> {
  try {
    if (!(await ports.isAllowed())) return 'not-allowed';
  } catch {
    return 'not-allowed';
  }
  return ports.drain();
}

/**
 * What a run is told about its own claim on the drain.
 *
 * Both answers come from the same lease because they bound the same thing from
 * two directions: whether a newer run has taken over, and how long there is
 * before one can.
 */
export interface DrainLease {
  /**
   * Whether this run is still the one the caller is waiting on.
   *
   * A run whose own step outlasted the lock has been superseded, and is working
   * from a list of held messages read before the run that replaced it existed.
   * Sending from that list would offer a code the newer run may already have
   * sent.
   */
  readonly stillOwned: () => boolean;
  /** How long is left before the lock behind this run is released. */
  readonly remainingMs: () => number;
}

/**
 * How long the caller can keep the process alive for a drain.
 *
 * A drain outliving its caller is the one thing the lease exists to prevent, so
 * the lease cannot be longer than the caller's own remaining time. A headless
 * task holds a wake lock only until it returns; a drain still acknowledging
 * after that is doing so on borrowed time, and a process killed mid-write
 * leaves a code that may have been taken still on offer.
 */
export type RemainingBudget = () => number;

/**
 * Wraps a drain so at most one runs at a time, and no work is left behind.
 *
 * The foreground poll fires every few seconds and a submit can outlast that.
 * Two drains at once would select the same held message and spend one of the
 * bank's few attempts re-sending a code it has already been given, so a caller
 * arriving mid-run waits.
 *
 * It waits for a *further* run rather than for the one already going, because
 * that run read the stash before the caller arrived: a message captured since
 * is not in the list it is working from. Every mid-run caller shares that one
 * follow-up, so a burst of poll ticks still costs a single extra drain.
 *
 * Waiting is bounded, because a drain can hang: nothing underneath it has a
 * deadline. An unbounded wait would hand every later caller — the poll and
 * every future wake-up alike — a promise that never settles, so one stuck
 * request would quietly stop held messages being drained for the life of the
 * process. Releasing the lock lets a second drain reach the same message, so
 * each run is given a lease and stops rather than send once it has run out of
 * it. That covers a run stuck anywhere before the send; a run stuck *in* the
 * send is covered by the send's own deadline, which the run takes from what is
 * left of the lease so that the two together always fit inside it.
 *
 * The lease is the shorter of that cap and what the caller has left, so the
 * chain from the caller's own deadline down to the send holds end to end.
 *
 * @param run - The drain to serialise, given its lease on the lock.
 * @returns A drain that is safe to call from a timer.
 */
export function createSerialDrain(
  run: (lease: DrainLease) => Promise<StashRunOutcome>,
): (budget: RemainingBudget) => Promise<StashRunOutcome> {
  let inFlight: Promise<StashRunOutcome> | null = null;
  let queued: Promise<StashRunOutcome> | null = null;
  let generation = 0;

  const start = (budget: RemainingBudget): Promise<StashRunOutcome> => {
    generation += 1;
    const mine = generation;
    const grant = granted(budget);
    const expiresAt = Date.now() + grant;
    const started = run({
      stillOwned: () => generation === mine,
      remainingMs: () => expiresAt - Date.now(),
    });
    const clear = (): void => {
      if (inFlight === started) inFlight = null;
    };
    inFlight = started;
    void settleWithin(started, grant).then(clear);
    return started;
  };

  return (budget) => {
    if (queued !== null) return queued;
    if (inFlight === null) return start(budget);
    queued = settleWithin(inFlight, granted(budget)).then(() => {
      queued = null;
      return start(budget);
    });
    return queued;
  };
}

/**
 * The lease a run may be given, being the shorter of the two limits on it.
 *
 * @param budget - What the caller has left.
 * @returns Milliseconds, never negative and never past the drain's own cap.
 */
function granted(budget: RemainingBudget): number {
  return Math.max(0, Math.min(TASK_BUDGET_MS, budget()));
}

/**
 * Drains held messages using this device's real stash and importer.
 *
 * @param budget - How long the caller can keep the process alive.
 * @returns What the drain decided, or `not-allowed` when it never ran.
 */
export const drainHeldMessages: (budget: RemainingBudget) => Promise<StashRunOutcome> =
  createSerialDrain((lease) =>
    runStashDrain({
      isAllowed: loadBackgroundCaptureAllowed,
      drain: () =>
        drainStash({
          loadSession: async () => backgroundSession(await loadConnection(), Date.now()),
          getPending: getPendingOtp,
          submit: submitOtp,
          now: Date.now,
          list: stash.list,
          consume: stash.consume,
          markAttempt: stash.markAttempt,
          stillOwned: lease.stillOwned,
          remainingMs: lease.remainingMs,
        }),
    }),
  );
