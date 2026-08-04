/**
 * Keeps the native auto-read window in step with what the importer is waiting
 * for.
 *
 * The Android receiver runs whether or not the app does, so it cannot ask the
 * app whether a code is expected — it reads a deadline the app has already
 * written to disk. This module owns that deadline: while a request is
 * outstanding the window is open, and the moment none is, it is shut.
 *
 * A deadline rather than a flag is deliberate. If the app is killed between
 * opening and closing, an unexpired deadline still lapses on its own; a boolean
 * would stay set and leave the receiver examining messages indefinitely.
 */
import OtpSmsConsentModule from '../../modules/otp-sms-consent/src/OtpSmsConsentModule';
import type { PendingOtpRequest } from '../api/otp';
import { loadBackgroundCaptureAllowed } from './otpBackgroundGate';
import { MAX_EXPECTATION_MS } from './otpExpectedWindow';

/**
 * Counts calls so a slow one can tell it has been overtaken.
 *
 * Module state on purpose: the window is a single piece of device state, and
 * every caller is writing that same one.
 */
let generation = 0;

/**
 * The moment after which arriving messages should be ignored again.
 *
 * Unlike {@link pickExpectation}, which chooses the single request a captured
 * code answers, this takes the *longest* live deadline: the window has to stay
 * open as long as any request could still be satisfied.
 *
 * @param pending - Requests the importer reports as awaiting a code.
 * @param now - Current time in epoch milliseconds.
 * @returns The deadline in epoch milliseconds, or `null` to close the window.
 */
export function autoReadWindowDeadline(
  pending: readonly PendingOtpRequest[],
  now: number,
): number | null {
  const latest = pending
    .filter((request) => request.deadline > now)
    .reduce<number | null>(
      (best, request) => (best === null || request.deadline > best ? request.deadline : best),
      null,
    );
  return latest === null ? null : Math.min(latest, now + MAX_EXPECTATION_MS);
}

/**
 * Writes the current window where the native receiver will find it.
 *
 * Does nothing on a build or platform without the native module, which is the
 * ordinary case: the default build has no receiver to gate.
 *
 * Only opening is gated on the user's switches. Closing is always allowed, so
 * a preference turned off mid-window is acted on by the next poll rather than
 * waiting for the deadline to lapse.
 *
 * Reading the switches means an open can land after a later call has already
 * shut the window — the poll and the screen teardown both call this. The newest
 * call therefore wins: an older one that was still reading gives up rather than
 * reopening a window nobody is watching any more.
 *
 * @param pending - Requests the importer reports as awaiting a code.
 * @param now - Current time in epoch milliseconds.
 */
export async function syncAutoReadWindow(
  pending: readonly PendingOtpRequest[],
  now: number = Date.now(),
): Promise<void> {
  generation += 1;
  const mine = generation;
  const deadline = autoReadWindowDeadline(pending, now);
  if (deadline === null) {
    OtpSmsConsentModule?.closeAutoReadWindow();
    return;
  }
  const allowed = await loadBackgroundCaptureAllowed();
  if (mine !== generation) return;
  if (!allowed) {
    OtpSmsConsentModule?.closeAutoReadWindow();
    return;
  }
  OtpSmsConsentModule?.openAutoReadWindow(deadline);
}
