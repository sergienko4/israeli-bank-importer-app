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
import { autoSubmitFromMessage, type BackgroundSubmitOutcome } from './otpBackgroundSubmit';
import { settleWithin, TASK_BUDGET_MS } from './otpDeadline';
import { retryUntilAnswered } from './otpRetry';
import { drainHeldMessages } from './otpStashRunner';

/** Must match `TASK_NAME` in `OtpSmsAutoReadService.kt`. */
export const OTP_SMS_TASK_NAME = 'OtpSmsAutoRead';

/**
 * Handles one wake-up from the native receiver.
 *
 * The switches are re-read here rather than trusted from the open window. The
 * window is a deadline on disk that outlives the process, so one opened before
 * the user changed their mind would otherwise still submit a code.
 *
 * A body means the receiver saw a capture window open and handed the message
 * straight over without keeping a copy. No body means it held the message
 * instead, because no window was open.
 *
 * Both are retried, because in neither case does the wake-up prove a request is
 * actually waiting *now*. The window is a deadline on disk written at the last
 * poll and closed only by a later one, so it can be live for minutes after the
 * request that opened it was answered — and banks routinely send the code before
 * the importer has finished raising the next request it answers. Submitting the
 * body once and dropping it would lose exactly the code this exists to catch,
 * and on that path nothing is holding a copy to try again from.
 *
 * The whole thing is bounded, because the calls underneath have no deadline of
 * their own and this runs with nobody watching. Returning is the only way this
 * task ends tidily: React Native releases the wake lock when the task settles,
 * and Android tears the service down without that courtesy once its own timeout
 * passes. Abandoning a request that was never going to answer is the lesser of
 * the two.
 *
 * @param data - The service payload, carrying the message body if there is one.
 */
export async function runOtpSmsTask(data: { readonly body?: string }): Promise<void> {
  await settleWithin(capture(data.body), TASK_BUDGET_MS);
}

/**
 * Spends the captured code, whichever way the receiver delivered it.
 *
 * @param body - The message text, when the receiver passed one over.
 */
async function capture(body: string | undefined): Promise<void> {
  if (!(await allowed())) {
    return;
  }
  if (typeof body === 'string' && body !== '') {
    await retryUntilAnswered({ attempt: () => submitBody(body), wait: sleep, now: Date.now });
    // An earlier held message may be the one that answers the next request, and
    // nothing else will look at it if the process stops here.
    await drainHeldMessages();
    return;
  }
  await retryUntilAnswered({ attempt: drainHeldMessages, wait: sleep, now: Date.now });
}

/**
 * Submits the code in one message, if the importer is waiting for one.
 *
 * @param body - The raw message text, never stored by this path.
 * @returns Why it stopped, so the caller can decide whether to look again.
 */
function submitBody(body: string): Promise<BackgroundSubmitOutcome> {
  return autoSubmitFromMessage(body, {
    loadSession: async () => backgroundSession(await loadConnection(), Date.now()),
    getPending: getPendingOtp,
    submit: submitOtp,
    now: Date.now,
  });
}

/**
 * Waits, without holding anything open that would keep the process alive.
 *
 * @param ms - How long to wait for.
 * @returns A promise resolving once the time has passed.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Reads the switches, treating a failure to read them as a no.
 *
 * Nothing here has a screen to report a problem on, and an unreadable
 * preference is not permission. Containing the failure also keeps it from
 * rejecting the whole task, which would skip the drain that follows.
 *
 * @returns True only when both switches are readable and on.
 */ async function allowed(): Promise<boolean> {
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
