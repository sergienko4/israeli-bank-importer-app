/**
 * Persists whether the user has opted in to reading one-time codes out of
 * incoming SMS automatically.
 *
 * This is the strongest of the three gates the user actually controls — the
 * build flag is fixed when the APK is made, and the Android grant is answered
 * once — so this boolean is what they will come back to when they change their
 * mind. It lives on the device only, for the same reason as the auto-submit
 * preference beside it: how a code reaches the field is a property of this
 * phone, not of the account.
 *
 * Every read failure resolves to off. Failing closed means a broken keystore
 * downgrades the user to the consent prompt rather than silently leaving an
 * SMS-reading path enabled with no way to see that it is on.
 */
import * as SecureStore from 'expo-secure-store';

const AUTO_READ_KEY = 'otp.autoRead.v1';

/** The only stored value that enables auto-read; anything else reads as off. */
const ENABLED = 'true';

/** The stored value written when the user turns auto-read off. */
const DISABLED = 'false';

/**
 * Reads whether auto-read is enabled on this device.
 *
 * Defaults to off, and stays off for an absent, corrupt, or unreadable entry.
 * @returns True only when the user has explicitly enabled auto-read.
 */
export async function loadOtpAutoRead(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(AUTO_READ_KEY)) === ENABLED;
  } catch {
    // A locked or corrupt keystore must not leave an SMS-reading path enabled.
    return false;
  }
}

/**
 * Stores the user's auto-read choice on this device.
 *
 * Write failures propagate deliberately, so the caller can tell the user the
 * choice did not stick rather than showing a switch that lies.
 * @param enabled - True to read codes from incoming messages automatically.
 * @throws When the secure store cannot be written.
 */
export async function saveOtpAutoRead(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(AUTO_READ_KEY, enabled ? ENABLED : DISABLED);
}
