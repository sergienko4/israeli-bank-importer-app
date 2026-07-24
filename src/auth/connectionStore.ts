/**
 * Persists the importer connection (base URL + bearer token) in the device
 * secure store (iOS Keychain / Android Keystore) — never plain storage — so a
 * returning user stays connected without re-entering their password.
 */
import * as SecureStore from 'expo-secure-store';

const KEY = 'importer.connection.v1';

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

/** Clears the stored connection (used on disconnect). */
export async function clearConnection(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
