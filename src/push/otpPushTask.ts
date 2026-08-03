/**
 * Starts the app when the importer asks for a code and nobody is watching.
 *
 * Android delivers a push carrying a title and body straight to the tray
 * without starting a terminated app, so the ordinary "OTP required" alert
 * cannot open the auto-read window on its own. Only a headless notification —
 * data and nothing else — runs a registered task with the process dead. The
 * importer therefore has to send one alongside the visible alert for this to
 * fire; without it the task simply never runs and the user types the code, as
 * they did before.
 *
 * Registered only in a build that carries the SMS receiver: elsewhere there is
 * no window to open, so waking the process would achieve nothing.
 */
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { getPendingOtp } from '../api/importerClient';
import { loadConnection } from '../auth/connectionStore';
import { isAutoReadBuild } from '../lib/otpAutoReadPermission';
import { syncAutoReadWindow } from '../lib/otpAutoReadWindow';
import { backgroundSession } from '../lib/otpBackgroundSession';
import { wakeAutoReadWindow } from '../lib/otpPushWake';

/** Identifies the task to both `expo-task-manager` and the OS. */
export const OTP_PUSH_TASK_NAME = 'OtpPushWake';

/**
 * Brings the window up to date using the importer as the only authority.
 *
 * @returns Nothing; the outcome matters to tests, not to the OS on Android.
 */
async function handlePush(): Promise<void> {
  await wakeAutoReadWindow({
    loadSession: async () => backgroundSession(await loadConnection(), Date.now()),
    getPending: getPendingOtp,
    syncWindow: syncAutoReadWindow,
    now: Date.now,
  });
}

/**
 * Defines and registers the background notification task.
 *
 * Called from the entry module so the task exists before anything can deliver
 * a notification to it, including a delivery that started the process.
 */
export function registerOtpPushTask(): void {
  if (Platform.OS !== 'android' || !isAutoReadBuild()) {
    return;
  }
  TaskManager.defineTask(OTP_PUSH_TASK_NAME, handlePush);
  Notifications.registerTaskAsync(OTP_PUSH_TASK_NAME).catch(() => {
    // Nothing to tell the user and nowhere to tell them: this runs before any
    // screen exists. Losing the wake costs zero-touch, not the code itself.
  });
}
