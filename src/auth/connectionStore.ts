/**
 * Persists the importer connection in the device secure store (iOS Keychain /
 * Android Keystore) — never plain storage — so a returning user stays connected
 * without signing in through the browser again.
 *
 * What is stored is a refresh token, not a password. The distinction matters:
 * a refresh token only works against one importer, it rotates on every use, and
 * the user can end it from the portal's session list. A password could do all
 * of that and more, forever, and could not be revoked without changing it.
 *
 * Earlier versions did store the portal password. {@link migrateLegacySecrets}
 * removes it on first launch after the upgrade, so an old install does not keep
 * a credential the app no longer has any use for.
 */
import * as SecureStore from 'expo-secure-store';

const KEY = 'importer.connection.v1';
const PASSWORD_KEY = 'importer.password.v1';
const CONNECTION_KEY = 'importer.connection.v2';

/** A saved importer connection. */
export interface Connection {
  baseUrl: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/**
 * Saves the connection to the secure store.
 * @param connection - The address and tokens to persist.
 */
export async function saveConnection(connection: Connection): Promise<void> {
  await SecureStore.setItemAsync(CONNECTION_KEY, JSON.stringify(connection));
}

/**
 * Reports whether a parsed entry carries every field the app relies on.
 * @param parsed - The parsed entry.
 * @returns True when the entry is a complete connection.
 */
function isComplete(parsed: Partial<Connection>): boolean {
  return (
    typeof parsed.baseUrl === 'string' &&
    typeof parsed.accessToken === 'string' &&
    typeof parsed.refreshToken === 'string' &&
    typeof parsed.expiresAt === 'number'
  );
}

/**
 * Loads the stored connection.
 *
 * A partial or corrupt entry reads as "not connected" rather than crashing
 * launch, which also covers the v1 entry an upgrade leaves behind.
 * @returns The saved connection, or null when none is usable.
 */
export async function loadConnection(): Promise<Connection | null> {
  const raw = await SecureStore.getItemAsync(CONNECTION_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Connection>;
    if (isComplete(parsed)) {
      return parsed as Connection;
    }
  } catch {
    // A corrupt entry is treated as "no connection" rather than crashing launch.
  }
  return null;
}

/** Clears the stored connection, including anything an older version left. */
export async function clearConnection(): Promise<void> {
  await SecureStore.deleteItemAsync(CONNECTION_KEY);
  await migrateLegacySecrets();
}

/**
 * Removes secrets written by versions that used password authentication.
 *
 * Runs at launch and is safe to run repeatedly: deleting a key that is not
 * there is not an error. Leaving the old password in the keychain would keep a
 * credential on the device that nothing can use and nobody can revoke.
 */
export async function migrateLegacySecrets(): Promise<void> {
  await SecureStore.deleteItemAsync(PASSWORD_KEY);
  await SecureStore.deleteItemAsync(KEY);
}
