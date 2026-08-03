/**
 * Runs a captured one-time code through to submission with no screen involved.
 *
 * The Android auto-read service starts this task; it may run while the app is
 * backgrounded or was not running at all. There is nobody present to answer a
 * prompt, so anything that would ask the user a question has to be treated as a
 * dead end rather than something to wait on.
 */
import { AppRegistry, Platform } from 'react-native';

import { getPendingOtp, type Session, submitOtp } from '../api/importerClient';
import { toSession } from '../auth/appSession';
import { type Connection, loadConnection } from '../auth/connectionStore';
import { isAutoReadBuild } from './otpAutoReadPermission';
import { autoSubmitFromMessage } from './otpBackgroundSubmit';

/** Must match `TASK_NAME` in `OtpSmsAutoReadService.kt`. */
export const OTP_SMS_TASK_NAME = 'OtpSmsAutoRead';

/**
 * Narrows a stored connection to one usable with nobody watching.
 *
 * An expired token is treated as no session at all. Renewing one requires a
 * biometric prompt, and raising that from a background task would either fail
 * outright or demand exactly the interaction this feature exists to remove. The
 * user finishes such a code by hand, which is the pre-existing behaviour.
 *
 * @param connection - The stored connection, or `null` when unpaired.
 * @param now - Current time in epoch milliseconds.
 * @returns A usable session, or `null` when the code must be typed instead.
 */
export function backgroundSession(connection: Connection | null, now: number): Session | null {
  if (connection === null || connection.expiresAt <= now) {
    return null;
  }
  return toSession(connection);
}

/**
 * Handles one message handed over by the native receiver.
 *
 * @param data - The service payload, carrying the message body.
 */
export async function runOtpSmsTask(data: { readonly body?: string }): Promise<void> {
  const body = data.body;
  if (typeof body !== 'string' || body === '') {
    return;
  }
  await autoSubmitFromMessage(body, {
    loadSession: async () => backgroundSession(await loadConnection(), Date.now()),
    getPending: getPendingOtp,
    submit: submitOtp,
    now: Date.now,
  });
}

/**
 * Registers the task so the native service can find it.
 *
 * Only a build carrying the receiver has anything to start this, so elsewhere
 * registering it would add a name nothing ever calls.
 */
export function registerOtpSmsTask(): void {
  if (Platform.OS !== 'android' || !isAutoReadBuild()) {
    return;
  }
  AppRegistry.registerHeadlessTask(OTP_SMS_TASK_NAME, () => runOtpSmsTask);
}
