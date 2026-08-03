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
 * Wraps a drain so at most one runs at a time.
 *
 * The foreground poll fires every few seconds and a submit can outlast that.
 * Two drains at once would select the same held message and spend one of the
 * bank's few attempts re-sending a code it has already been given, so a caller
 * arriving mid-run joins that run rather than starting another.
 *
 * @param run - The drain to serialise.
 * @returns A drain that is safe to call from a timer.
 */
export function createSerialDrain(
  run: () => Promise<StashRunOutcome>,
): () => Promise<StashRunOutcome> {
  let inFlight: Promise<StashRunOutcome> | null = null;
  return () => {
    inFlight ??= run().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}

/**
 * Drains held messages using this device's real stash and importer.
 *
 * @returns What the drain decided, or `not-allowed` when it never ran.
 */
export const drainHeldMessages: () => Promise<StashRunOutcome> = createSerialDrain(() =>
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
      }),
  }),
);
