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
import { MAX_EXPECTATION_MS } from './otpExpectedWindow';

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
 * @param pending - Requests the importer reports as awaiting a code.
 * @param now - Current time in epoch milliseconds.
 */
export function syncAutoReadWindow(
  pending: readonly PendingOtpRequest[],
  now: number = Date.now(),
): void {
  const deadline = autoReadWindowDeadline(pending, now);
  if (deadline === null) {
    OtpSmsConsentModule?.closeAutoReadWindow();
    return;
  }
  OtpSmsConsentModule?.openAutoReadWindow(deadline);
}
