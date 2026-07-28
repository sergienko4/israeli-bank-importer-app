/**
 * Persists the importer connection (base URL + bearer token) in the device
 * secure store (iOS Keychain / Android Keystore) — never plain storage — so a
 * returning user stays connected without re-entering their password. When the
 * user opts into quick unlock, the portal password is stored under a separate
 * secure key so the app can silently re-authenticate after the 12h token
 * expires (see {@link savePassword}); access to it is gated by biometrics.
 */
import * as SecureStore from 'expo-secure-store';

const KEY = 'importer.connection.v1';
const PASSWORD_KEY = 'importer.password.v1';

/** A saved importer connection. */
export interface Connection {
  baseUrl: string;
  token: string;
}

/**
 * Saves the connection to the secure store.
 * @param connection - The base URL + bearer token to persist.
 */
export async function saveConnection(connection: Connection): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(connection));
}

/**
 * Loads the stored connection.
 * @returns The saved connection, or null when none is stored or it is corrupt.
 */
export async function loadConnection(): Promise<Connection | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Connection>;
    if (typeof parsed.baseUrl === 'string' && typeof parsed.token === 'string') {
      return { baseUrl: parsed.baseUrl, token: parsed.token };
    }
  } catch {
    // A corrupt entry is treated as "no connection" rather than crashing launch.
  }
  return null;
}

/** Clears the stored connection and any stored password (used on disconnect). */
export async function clearConnection(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
  await clearPassword();
}

/**
 * Stores the portal password for quick unlock (secure store only; callers gate
 * access with biometrics). Enables silent re-auth after token expiry.
 * @param password - The portal password to persist.
 */
export async function savePassword(password: string): Promise<void> {
  await SecureStore.setItemAsync(PASSWORD_KEY, password);
}

/**
 * Loads the stored portal password, if quick unlock is enabled.
 * @returns The stored password, or null when none is stored.
 */
export async function loadPassword(): Promise<string | null> {
  return SecureStore.getItemAsync(PASSWORD_KEY);
}

/** Removes the stored portal password (disables quick unlock). */
export async function clearPassword(): Promise<void> {
  await SecureStore.deleteItemAsync(PASSWORD_KEY);
}

/**
 * Reports whether a portal password is stored for quick unlock.
 * @returns True when a password is available for silent re-auth.
 */
export async function hasStoredPassword(): Promise<boolean> {
  return (await SecureStore.getItemAsync(PASSWORD_KEY)) !== null;
}
