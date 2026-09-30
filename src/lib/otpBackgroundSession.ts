/**
 * Derives a usable session for work that runs with nobody watching.
 *
 * Kept apart from the tasks that use it because all three background entry
 * points need it — the headless SMS task, the push wake, and the stash drain —
 * and routing it through any one of them would tie the other two to that one's
 * imports.
 *
 * The access token lasts minutes, and the user may not have opened the app for
 * days, so the stored token has usually expired by the time a code arrives. The
 * screen renews behind a biometric prompt, which cannot be shown from here: it
 * never answers off screen. This renews without one instead, and contains what
 * that buys:
 *
 * - Every caller checks the user's two capture switches first, so nothing here
 *   runs for a user who has not opted in.
 * - The renewed pair is saved already expired. The rotated refresh token has to
 *   be stored, because the one it replaced is spent, but the access token stays
 *   in memory: the screen reads the saved pair as expired and asks for an
 *   unlock before it uses anything, exactly as it did before.
 */
import { type AppTokens, refreshTokens } from '../api/appTokens';
import type { Session } from '../api/importerClient';
import { toSession } from '../auth/appSession';
import { type Connection, loadConnection, saveConnection } from '../auth/connectionStore';
import { withRefreshLock } from '../auth/refreshLock';
import { TASK_TIMEOUT_MS } from './otpDeadline';

/** Saved in place of a background renewal's real expiry, so the screen never uses it unprompted. */
export const SAVED_EXPIRED = 0;

/** What an unattended renewal needs, injected so it can be tested without a device. */
export interface UnattendedSessionPorts {
  /** The stored connection, or null when the device is not paired. */
  readonly load: () => Promise<Connection | null>;
  /** Replaces the stored connection. */
  readonly save: (connection: Connection) => Promise<void>;
  /** Spends a refresh token for a new pair. */
  readonly refresh: (baseUrl: string, refreshToken: string) => Promise<AppTokens>;
  /** The current time, injected so expiry is testable. */
  readonly now: () => number;
}

/** A pair this process renewed, remembered with the refresh token it spent. */
interface Renewal {
  /** The pair the portal issued, with its real expiry. */
  readonly pair: Connection;
  /** The refresh token presented for it, which the portal has now retired. */
  readonly spent: string;
}

/**
 * Builds the loader every background entry point asks for a session.
 *
 * A stored token that outlasts a whole task is used as it is. Anything shorter
 * is renewed, since a token that expired mid-task would turn a code the importer
 * is waiting for into a 401.
 *
 * The pair renewed here is remembered for the life of the process. The saved
 * copy reads as expired, so without that every retry of one capture would spend
 * another refresh token. It is only used while storage still holds its refresh
 * token — or the one it replaced, when the save failed — so a later renewal by
 * the screen always wins.
 *
 * Runs under the refresh lock, because the screen spends the same single-use
 * refresh token and a second presentation ends the whole session.
 *
 * @param ports - The injected storage, portal, and clock.
 * @returns A loader resolving to a usable session, or `null` when unpaired.
 */
export function createUnattendedSession(
  ports: UnattendedSessionPorts,
): () => Promise<Session | null> {
  let renewal: Renewal | null = null;

  const newest = (stored: Connection): Connection => {
    if (renewal?.pair.baseUrl !== stored.baseUrl) return stored;
    const current =
      stored.refreshToken === renewal.pair.refreshToken || stored.refreshToken === renewal.spent;
    return current ? renewal.pair : stored;
  };

  return () =>
    withRefreshLock(async () => {
      const stored = await ports.load();
      if (stored === null) {
        renewal = null;
        return null;
      }
      const pair = newest(stored);
      if (pair.expiresAt - ports.now() > TASK_TIMEOUT_MS) return toSession(pair);

      const tokens = await ports.refresh(pair.baseUrl, pair.refreshToken);
      const next: Connection = {
        baseUrl: pair.baseUrl,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      };
      renewal = { pair: next, spent: pair.refreshToken };
      try {
        await ports.save({ ...next, expiresAt: SAVED_EXPIRED });
      } catch {
        // The presented token is already spent. The pair is kept in memory for
        // this process, which is the only copy of a refresh token still valid.
      }
      return toSession(next);
    });
}

/**
 * Loads a session for background work, renewing the token without a prompt.
 *
 * @returns A usable session, or `null` when the device is not paired.
 * @throws Error when the portal refused or could not be reached; every caller
 *   treats that as a failed attempt worth retrying.
 */
export const loadUnattendedSession: () => Promise<Session | null> = createUnattendedSession({
  load: loadConnection,
  save: saveConnection,
  refresh: refreshTokens,
  now: Date.now,
});
