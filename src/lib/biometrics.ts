/**
 * Biometric gate over expo-local-authentication. Reports availability (hardware
 * present with a fingerprint/face enrolled) and prompts the user to authenticate.
 * The prompt result is fail-closed: callers only unlock on an explicit success.
 */
import * as LocalAuthentication from 'expo-local-authentication';

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
 * Reports whether biometric authentication can be used on this device.
 * @returns True when biometric hardware is present and a credential is enrolled.
 */
export async function isBiometricAvailable(): Promise<boolean> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) {
      return false;
    }
    return await LocalAuthentication.isEnrolledAsync();
  } catch (error: unknown) {
    void error;
    return false;
  }
}

/**
 * Prompts the user to authenticate with biometrics.
 * @param reason - The prompt message shown to the user.
 * @returns Success, unsupported when biometrics are not configured, or failed.
 */
export async function authenticateBiometric(reason: string): Promise<BiometricAuthResult> {
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
  } catch (error: unknown) {
    void error;
    return { status: 'failed' };
  }
}
