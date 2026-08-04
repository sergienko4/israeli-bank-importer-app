/**
 * Decides how the app may capture a one-time code, given what this build,
 * this user and this device each permit.
 *
 * The point of resolving it in one pure function is that the fallback is
 * impossible to get wrong by accident: reaching {@link OtpCaptureMode}
 * `autoread` needs four unrelated things to agree, and shutting any one of
 * them lands on the flow that asks the user per message.
 *
 * The modes are alternatives, not layers. Running the consent flow alongside a
 * live auto-read window would show the user a dialog asking to read a message
 * whose code the receiver has already sent — a decision with nothing left to
 * decide, in a feature whose whole point is that it needs no decision.
 */
import { hasReceiveSms, isAutoReadBuild } from './otpAutoReadPermission';
import { loadOtpAutoRead } from './otpAutoReadStore';
import { loadOtpAutoSubmit } from './otpAutoSubmitStore';

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
  /**
   * Whether the user also allows a code to be sent unconfirmed.
   *
   * Required because it is what opens the native window: with it off the
   * receiver never delivers, so treating this as `autoread` would suppress the
   * consent flow in favour of a path that does nothing.
   */
  readonly autoSubmitEnabled: boolean;
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
  if (
    gates.autoReadBuild &&
    gates.autoReadEnabled &&
    gates.autoSubmitEnabled &&
    gates.smsPermissionGranted
  ) {
    return 'autoread';
  }
  return gates.consentAvailable ? 'consent' : 'manual';
}

/**
 * Reads every gate on this device and resolves the mode in force now.
 *
 * Each source resolves to its closed value when it cannot be read, so an
 * unreadable preference or a device that will not answer about permissions
 * lands on the flow that asks the user rather than on a silent one.
 *
 * @param consentAvailable - Whether this platform has the consent module.
 * @returns The mode to use for the request currently on screen.
 */
export async function loadOtpCaptureMode(consentAvailable: boolean): Promise<OtpCaptureMode> {
  const [autoReadEnabled, autoSubmitEnabled, smsPermissionGranted] = await Promise.all([
    loadOtpAutoRead(),
    loadOtpAutoSubmit(),
    hasReceiveSms(),
  ]);
  return resolveOtpCaptureMode({
    autoReadBuild: isAutoReadBuild(),
    autoReadEnabled,
    autoSubmitEnabled,
    smsPermissionGranted,
    consentAvailable,
  });
}
