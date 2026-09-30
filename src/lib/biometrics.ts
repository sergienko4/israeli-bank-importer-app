/**
 * Biometric gate over expo-local-authentication. Prompts the user and reports
 * the outcome fail-closed: callers only unlock on an explicit success, and a
 * device with no hardware or nothing enrolled is reported as unsupported rather
 * than waved through.
 */
import * as LocalAuthentication from 'expo-local-authentication';
import { AppState } from 'react-native';

type LocalAuthenticationFailure = Extract<
  Awaited<ReturnType<typeof LocalAuthentication.authenticateAsync>>,
  { success: false }
>;

/** Biometric prompt result used by callers to avoid fail-open unlocks. */
export type BiometricAuthResult =
  | { status: 'success' }
  | { status: 'unsupported' }
  | { status: 'failed'; error?: LocalAuthenticationFailure['error'] };

const UNSUPPORTED_PROMPT_ERRORS: ReadonlySet<LocalAuthenticationFailure['error']> = new Set([
  'not_available',
  'not_enrolled',
  'passcode_not_set',
]);

/**
 * Prompts the user to authenticate with biometrics.
 *
 * Refused outright unless the app is on screen. The prompt is a dialog on the
 * visible activity; asked for from the background — a headless task, or a
 * timer that fired after the user switched away — AndroidX logs "Called after
 * onSaveInstanceState()" and never calls back. The caller would then wait
 * forever, and the native module, still marked as authenticating, would answer
 * every later prompt with `app_cancel` until the process died.
 * @param reason - The prompt message shown to the user.
 * @returns Success, unsupported when biometrics are not configured, or failed.
 */
export async function authenticateBiometric(reason: string): Promise<BiometricAuthResult> {
  if (AppState.currentState !== 'active') {
    return { status: 'failed' };
  }
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) {
      return { status: 'unsupported' };
    }
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    if (!isEnrolled) {
      return { status: 'unsupported' };
    }
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: reason });
    if (result.success) {
      return { status: 'success' };
    }
    if (UNSUPPORTED_PROMPT_ERRORS.has(result.error)) {
      return { status: 'unsupported' };
    }
    return { status: 'failed', error: result.error };
  } catch {
    // Fail closed. A thrown value is not a LocalAuthentication error code, so
    // `error` stays unset rather than carrying an untyped value.
    return { status: 'failed' };
  }
}
