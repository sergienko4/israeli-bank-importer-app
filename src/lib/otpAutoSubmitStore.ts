/**
 * Persists whether the user has opted in to auto-submitting a one-time code.
 *
 * The preference lives on the device only. It is never sent to the importer:
 * how a code reaches the field is a property of this phone, not of the account,
 * and syncing it would let one device change another device's behaviour.
 *
 * It is kept in the secure store (iOS Keychain / Android Keystore) rather than
 * plain storage. The value is not a secret, but it decides whether a code can
 * leave the device without the user pressing anything, so it deserves the same
 * tamper resistance as the tokens beside it - and `expo-secure-store` is
 * already a dependency, so this costs nothing.
 *
 * Every read failure resolves to off. Failing closed means a broken keystore
 * downgrades the user to typing the code, which is exactly what they do today.
 */
import * as SecureStore from 'expo-secure-store';

const AUTO_SUBMIT_KEY = 'otp.autoSubmit.v1';

/** The only stored value that enables auto-submit; anything else reads as off. */
const ENABLED = 'true';

/** The stored value written when the user turns auto-submit off. */
const DISABLED = 'false';

/**
 * Reads whether auto-submit is enabled on this device.
 *
 * Defaults to off, and stays off for an absent, corrupt, or unreadable entry,
 * so a fresh install and a broken keystore both behave like today's manual
 * entry rather than sending a code the user never approved.
 * @returns True only when the user has explicitly enabled auto-submit.
 */
export async function loadOtpAutoSubmit(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(AUTO_SUBMIT_KEY)) === ENABLED;
  } catch {
    // A locked or corrupt keystore must not fail open, and must not crash the
    // OTP sheet while the user is trying to enter a code by hand.
    return false;
  }
}

/**
 * Stores the user's auto-submit choice on this device.
 *
 * Write failures propagate deliberately. A user who turns auto-submit off and
 * is not told the write failed would believe codes are no longer sent
 * automatically while they still are, so the caller has to surface this.
 * @param enabled - True to auto-submit a filled code, false to always confirm.
 * @throws When the secure store cannot be written.
 */
export async function saveOtpAutoSubmit(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(AUTO_SUBMIT_KEY, enabled ? ENABLED : DISABLED);
}
