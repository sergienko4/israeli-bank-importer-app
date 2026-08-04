/**
 * Runs a captured one-time code through to submission with no screen involved.
 *
 * The Android auto-read service starts this task; it may run while the app is
 * backgrounded or was not running at all. There is nobody present to answer a
 * prompt, so anything that would ask the user a question has to be treated as a
 * dead end rather than something to wait on.
 */
import { AppRegistry, Platform } from 'react-native';

import { getPendingOtp, submitOtp } from '../api/importerClient';
import { loadConnection } from '../auth/connectionStore';
import { isAutoReadBuild } from './otpAutoReadPermission';
import { loadBackgroundCaptureAllowed } from './otpBackgroundGate';
import { backgroundSession } from './otpBackgroundSession';
import { autoSubmitFromMessage } from './otpBackgroundSubmit';
import { drainHeldMessages } from './otpStashRunner';

/** Must match `TASK_NAME` in `OtpSmsAutoReadService.kt`. */
export const OTP_SMS_TASK_NAME = 'OtpSmsAutoRead';

/**
 * Handles one message handed over by the native receiver.
 *
 * The switches are re-read here rather than trusted from the open window. The
 * window is a deadline on disk that outlives the process, so one opened before
 * the user changed their mind would otherwise still submit a code.
 *
 * A drain follows, because this message may not be the one that answers the
 * request: an earlier code held before anything asked for it would otherwise
 * sit there until the next poll, and there may not be one if the app is not
 * running.
 *
 * @param data - The service payload, carrying the message body.
 */
export async function runOtpSmsTask(data: { readonly body?: string }): Promise<void> {
  const body = data.body;
  if (typeof body !== 'string' || body === '') {
    return;
  }
  if (!(await allowed())) {
    return;
  }
  await autoSubmitFromMessage(body, {
    loadSession: async () => backgroundSession(await loadConnection(), Date.now()),
    getPending: getPendingOtp,
    submit: submitOtp,
    now: Date.now,
  });
  await drainHeldMessages();
}

/**
 * Reads the switches, treating a failure to read them as a no.
 *
 * Nothing here has a screen to report a problem on, and an unreadable
 * preference is not permission. Containing the failure also keeps it from
 * rejecting the whole task, which would skip the drain that follows.
 *
 * @returns True only when both switches are readable and on.
 */
async function allowed(): Promise<boolean> {
  try {
    return await loadBackgroundCaptureAllowed();
  } catch {
    return false;
  }
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
