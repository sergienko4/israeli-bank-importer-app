/**
 * Decides how the app may capture a one-time code, given what this build,
 * this user and this device each permit.
 *
 * The point of resolving it in one pure function is that the fallback is
 * impossible to get wrong by accident: reaching {@link OtpCaptureMode}
 * `autoread` needs three unrelated things to agree, and shutting any one of
 * them lands on the flow that asks the user per message.
 */

/** How a one-time code reaches the OTP field. */
export type OtpCaptureMode =
  /** The user reads the code and types it. Always available. */
  | 'manual'
  /** Android shows the message and the user taps Allow. Costs no permission. */
  | 'consent'
  /** The app reads arriving messages itself. Costs `RECEIVE_SMS`. */
  | 'autoread';

/** The independent conditions that decide the capture mode. */
export interface OtpCaptureGates {
  /** Whether this build declared `RECEIVE_SMS`. Fixed at build time. */
  readonly autoReadBuild: boolean;
  /** Whether the user turned auto-read on. Off by default. */
  readonly autoReadEnabled: boolean;
  /** Whether Android has granted `RECEIVE_SMS`. Revocable at any time. */
  readonly smsPermissionGranted: boolean;
  /** Whether the per-message consent flow can run on this device. */
  readonly consentAvailable: boolean;
}

/**
 * Resolves the highest capture mode every gate permits.
 *
 * Deliberately has no default parameters: a caller that cannot answer one of
 * these questions should not be choosing a mode.
 *
 * @param gates - What the build, the user and the device each permit.
 * @returns The mode to use now. Re-resolve after any of the gates can change.
 */
export function resolveOtpCaptureMode(gates: OtpCaptureGates): OtpCaptureMode {
  if (gates.autoReadBuild && gates.autoReadEnabled && gates.smsPermissionGranted) {
    return 'autoread';
  }
  return gates.consentAvailable ? 'consent' : 'manual';
}
