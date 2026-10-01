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
 * - It checks the user's capture switches itself before touching anything, so
 *   no entry point can spend a token for a user who has not opted in — the
 *   push wake, which reaches it before any switch is read, included.
 * - The renewed pair is saved with its access token withheld and already
 *   expired. The rotated refresh token has to be stored, because the one it
 *   replaced is spent, but the access token stays in memory: the screen reads
 *   the saved pair as expired and asks for an unlock, and a cancelled unlock
 *   leaves it with nothing to send.
 */
import { type AppTokens, refreshTokens } from '../api/appTokens';
import type { Session } from '../api/importerClient';
import { answerInTime } from '../api/timedFetch';
import { toSession } from '../auth/appSession';
import { type Connection, loadConnection, saveConnection } from '../auth/connectionStore';
import { withRefreshLock } from '../auth/refreshLock';
import { processLedger, type TokenLedger } from '../auth/tokenLedger';
import { loadBackgroundCaptureAllowed } from './otpBackgroundGate';
import { TASK_TIMEOUT_MS } from './otpDeadline';

/** Saved in place of a background renewal's real expiry, so the screen never uses it unprompted. */
export const SAVED_EXPIRED = 0;

/** Saved in place of a background renewal's access token, so a cancelled unlock sends nothing. */
export const WITHHELD_ACCESS = '';

/** What an unattended renewal needs, injected so it can be tested without a device. */
export interface UnattendedSessionPorts {
  /** Whether the user's switches currently allow background capture. */
  readonly allowed: () => Promise<boolean>;
  /** The stored connection, or null when the device is not paired. */
  readonly load: () => Promise<Connection | null>;
  /** Replaces the stored connection. */
  readonly save: (connection: Connection) => Promise<void>;
  /** Spends a refresh token for a new pair. */
  readonly refresh: (baseUrl: string, refreshToken: string) => Promise<AppTokens>;
  /** The current time, injected so expiry is testable. */
  readonly now: () => number;
  /** The record of renewals this process shares with the screen. */
  readonly ledger: TokenLedger;
}

/**
 * Saves a pair with its access token withheld, so storage names the live
 * refresh token.
 *
 * A failure is not reported: the token it replaces is already spent, so the
 * ledger's copy is the only valid one, and the next call writes it again. Until
 * one write succeeds, a process that dies leaves storage with the spent token.
 *
 * @param save - Writes the pair to storage.
 * @param pair - The pair holding the live refresh token.
 */
async function keep(save: UnattendedSessionPorts['save'], pair: Connection): Promise<void> {
  try {
    await save({ ...pair, accessToken: WITHHELD_ACCESS, expiresAt: SAVED_EXPIRED });
  } catch {
    // Retried on the next call; see above.
  }
}

/**
 * Builds the loader every background entry point asks for a session.
 *
 * A stored token that outlasts a whole task is used as it is. Anything shorter
 * is renewed, since a token that expired mid-task would turn a code the importer
 * is waiting for into a 401.
 *
 * The pair renewed here is kept in the process ledger, which the screen shares.
 * The saved copy is withheld, so without the ledger every retry of one capture
 * would spend another refresh token, and a failed save would leave storage
 * naming a token the portal has already retired.
 *
 * Runs under the refresh lock, because the screen spends the same single-use
 * refresh token and a second presentation ends the whole session. A renewal
 * whose reply misses the usual deadline is answered as a failure but keeps the
 * lock until the reply is kept, since the portal retired the presented token on
 * accepting it and the reply holds the only live one.
 *
 * @param ports - The injected switches, storage, portal, clock, and ledger.
 * @returns A loader resolving to a usable session, or `null` when unpaired or
 * when capture is switched off.
 */
export function createUnattendedSession(
  ports: UnattendedSessionPorts,
): () => Promise<Session | null> {
  return () =>
    withRefreshLock(async (hold) => {
      if (!(await ports.allowed())) return null;
      const stored = await ports.load();
      if (stored === null) {
        ports.ledger.forget();
        return null;
      }
      const pair = ports.ledger.current(stored);
      if (pair.expiresAt - ports.now() > TASK_TIMEOUT_MS) {
        if (pair.refreshToken !== stored.refreshToken) await keep(ports.save, pair);
        return toSession(pair);
      }

      const renewal = renew(ports, pair);
      hold(renewal);
      return toSession(await answerInTime(renewal));
    });
}

/**
 * Presents a refresh token, then records and keeps the pair it buys.
 *
 * @param ports - The portal, storage, and ledger to renew through.
 * @param pair - The pair whose refresh token is live.
 * @returns The renewed pair.
 */
async function renew(ports: UnattendedSessionPorts, pair: Connection): Promise<Connection> {
  const tokens = await ports.refresh(pair.baseUrl, pair.refreshToken);
  const next: Connection = {
    baseUrl: pair.baseUrl,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
  };
  ports.ledger.record(pair, next);
  await keep(ports.save, next);
  return next;
}

/**
 * Loads a session for background work, renewing the token without a prompt.
 *
 * @returns A usable session, or `null` when the device is not paired or the
 *   user's switches do not allow background capture.
 * @throws Error when the portal refused or could not be reached; every caller
 *   treats that as a failed attempt worth retrying.
 */
export const loadUnattendedSession: () => Promise<Session | null> = createUnattendedSession({
  allowed: loadBackgroundCaptureAllowed,
  load: loadConnection,
  save: saveConnection,
  refresh: refreshTokens,
  now: Date.now,
  ledger: processLedger,
});
