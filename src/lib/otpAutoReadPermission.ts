/**
 * Binds the auto-read decision to the two platform surfaces it needs: the
 * build flag baked into the app config, and Android's runtime permission
 * dialog.
 *
 * The mapping from Android's answer to our own vocabulary is separated out and
 * tested, because the distinction it draws is the one the UI depends on:
 * `never_ask_again` is not just another refusal, it means the dialog will not
 * appear again and the user has to be sent to system settings instead.
 */
import Constants from 'expo-constants';
import { PermissionsAndroid, Platform } from 'react-native';

import type { PermissionOutcome } from './otpAutoReadToggle';

/**
 * Translates Android's permission result into the outcomes this app acts on.
 *
 * @param status - The raw result from `PermissionsAndroid.request`.
 * @returns The outcome the toggle logic understands.
 */
export function toPermissionOutcome(status: string): PermissionOutcome {
  if (status === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
  // Anything Android will not re-prompt for is `blocked`, because asking again
  // is a no-op and the user would see a switch that never moves.
  if (status === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return 'blocked';
  return 'denied';
}

/**
 * Whether this build was produced with SMS auto-read compiled in.
 *
 * Reads the flag the app config wrote at build time. A build without it has no
 * SMS permission in its manifest at all, so the feature must stay hidden rather
 * than offering a switch that could never work.
 * @returns True only for a build made with `OTP_SMS_AUTOREAD=1`.
 */
export function isAutoReadBuild(): boolean {
  return Constants.expoConfig?.extra?.otpSmsAutoRead === true;
}

/**
 * Asks Android for permission to receive SMS, showing the system dialog.
 *
 * @returns The user's answer, or `denied` on any platform without the dialog.
 */
export async function requestReceiveSms(): Promise<PermissionOutcome> {
  if (Platform.OS !== 'android') return 'denied';
  const status = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS, {
    title: 'Read bank codes from messages',
    message:
      'This lets the app fill in a bank one-time code by itself. It only looks at a message while a code is outstanding, and never stores it.',
    buttonPositive: 'Allow',
    buttonNegative: 'Not now',
  });
  return toPermissionOutcome(status);
}
