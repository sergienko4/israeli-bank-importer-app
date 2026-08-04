/**
 * Decides whether the background capture path may run at all.
 *
 * The Android grant is answered once and then stays granted, so the runtime
 * permission cannot express "stop doing this". The two switches the user can
 * still move are the only thing that can, which makes this the gate that has to
 * be consulted before a message is examined or a code is sent.
 *
 * Both switches are required, not either. Auto-read with auto-submit off means
 * the user wants to confirm each code, and the background path has no way to
 * offer that: when the process was started by an arriving message there is no
 * screen to fill in, and holding the code until one appears would store a
 * one-time code the app promises never to keep. The foreground consent prompt
 * already serves that combination, so the background window simply stays shut.
 */
import { loadOtpAutoRead } from './otpAutoReadStore';
import { loadOtpAutoSubmit } from './otpAutoSubmitStore';

/**
 * Whether the two user-controlled switches together permit background capture.
 *
 * @param autoRead - Whether the user allows codes to be read from messages.
 * @param autoSubmit - Whether the user allows a code to be sent unconfirmed.
 * @returns True only when both are on.
 */
export function backgroundCaptureAllowed(autoRead: boolean, autoSubmit: boolean): boolean {
  return autoRead && autoSubmit;
}

/**
 * Reads both stored preferences and applies {@link backgroundCaptureAllowed}.
 *
 * Both stores resolve to off when unreadable, so a broken keystore closes the
 * window rather than leaving an SMS-reading path running unseen.
 *
 * @returns True only when the user has enabled auto-read and auto-submit.
 */
export async function loadBackgroundCaptureAllowed(): Promise<boolean> {
  const [autoRead, autoSubmit] = await Promise.all([loadOtpAutoRead(), loadOtpAutoSubmit()]);
  return backgroundCaptureAllowed(autoRead, autoSubmit);
}
