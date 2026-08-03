/**
 * The gate that decides whether a change to the OTP field may be submitted
 * without the user pressing the button.
 *
 * Automatic submission spends one of the bank's small number of attempts, so
 * this is a security control rather than a convenience: it must fail closed.
 * Every term below is a separate reason to stay manual, and the tests beside
 * this file pin each one so a later edit cannot quietly drop one.
 */
import { isOtpFillEvent } from './otpCode';

/** Everything the arming decision is allowed to depend on. */
export interface AutoSubmitArmInput {
  /** Whether the user has opted in to automatic submission. */
  readonly enabled: boolean;
  /**
   * Whether this pending request has already armed once. Automatic submission
   * is a single shot per request: a code the importer rejected must not be
   * re-sent, and a spoofed message must not be able to retry.
   */
  readonly alreadyArmed: boolean;
  /** The normalised field value before the change. */
  readonly previous: string;
  /** The normalised field value after the change. */
  readonly next: string;
}

/**
 * Decides whether a field change should start the automatic-submit countdown.
 * @param input - The opt-in state, the per-request guard, and the value change.
 * @returns True only when every condition for automatic submission holds.
 */
export function shouldArmAutoSubmit(input: AutoSubmitArmInput): boolean {
  const { enabled, alreadyArmed, previous, next } = input;
  if (!enabled || alreadyArmed) {
    return false;
  }
  return isOtpFillEvent(previous, next);
}
