/**
 * Biometric gate over expo-local-authentication. Reports availability (hardware
 * present with a fingerprint/face enrolled) and prompts the user to authenticate.
 * Degrades cleanly: unavailable devices — including iOS Face ID in Expo Go —
 * report false so callers fall back to the password.
 */
import * as LocalAuthentication from 'expo-local-authentication';

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
  } catch {
    return false;
  }
}

/**
 * Prompts the user to authenticate with biometrics.
 * @param reason - The prompt message shown to the user.
 * @returns True when authentication succeeded.
 */
export async function authenticateBiometric(reason: string): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: reason });
    return result.success;
  } catch {
    return false;
  }
}
