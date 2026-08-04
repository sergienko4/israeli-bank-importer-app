/**
 * Derives a usable session for work that runs with nobody watching.
 *
 * Kept apart from the tasks that use it because all three background entry
 * points need it — the headless SMS task, the push wake, and the stash drain —
 * and routing it through any one of them would tie the other two to that one's
 * imports.
 */
import type { Session } from '../api/importerClient';
import { toSession } from '../auth/appSession';
import type { Connection } from '../auth/connectionStore';

/**
 * Narrows a stored connection to one usable with nobody watching.
 *
 * An expired token is treated as no session at all. Renewing one requires a
 * biometric prompt, and raising that from a background task would either fail
 * outright or demand exactly the interaction this feature exists to remove. The
 * user finishes such a code by hand, which is the pre-existing behaviour.
 *
 * @param connection - The stored connection, or `null` when unpaired.
 * @param now - Current time in epoch milliseconds.
 * @returns A usable session, or `null` when the code must be typed instead.
 */
export function backgroundSession(connection: Connection | null, now: number): Session | null {
  if (connection === null || connection.expiresAt <= now) {
    return null;
  }
  return toSession(connection);
}
