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
 *   push wake, which reaches it before any switch is read, included. It checks
 *   them again, in turn with any change to them, straight before it spends the
 *   refresh token.
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
import { startIfAllowed } from './otpCaptureSwitch';

/** Saved in place of a background renewal's real expiry, so the screen never uses it unprompted. */
export const SAVED_EXPIRED = 0;

/** Saved in place of a background renewal's access token, so a cancelled unlock sends nothing. */
export const WITHHELD_ACCESS = '';

/**
 * How close to expiry a token may get before a background load renews it.
 *
 * Enough for one attempt's requests to finish on the token it was handed. It is
 * deliberately not the task's timeout: that also covers waiting for a renewal
 * to be kept, which makes no request with the token.
 */
export const RENEW_WITHIN_MS = 60_000;

/** Why a load refused to renew: its caller could not keep the process alive long enough. */
export const NO_TIME_TO_RENEW = 'No time left to keep a renewed token.';

/**
 * Loads a session for background work.
 *
 * `left` is how long the caller keeps the process alive. Without it the load
 * renews whenever it must, as it does for a caller with no deadline of its own.
 */
export type UnattendedSessionLoader = (left?: () => number) => Promise<Session | null>;

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
 * A stored token with more than {@link RENEW_WITHIN_MS} left is used as it is.
 * Anything shorter is renewed, since a token that expired mid-attempt would
 * turn a code the importer is waiting for into a 401.
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
 * That is also why no renewal starts once the caller's time is up: the caller
 * waits for a renewal to be kept before it lets the process go, but only for
 * one started while it was still keeping the process alive. The time is read
 * as the renewal starts, because waiting for the lock can take most of a
 * minute.
 *
 * The switches are read twice. The first read spares an opted-out user even
 * the storage read. The second is taken in turn with the switches being
 * written, straight before the token is spent, because the user can turn
 * capture off while the stored pair is read.
 *
 * @param ports - The injected switches, storage, portal, clock, and ledger.
 * @returns A loader resolving to a usable session, or `null` when unpaired or
 * when capture is switched off. It rejects with {@link NO_TIME_TO_RENEW} rather
 * than renew for a caller with no time left.
 */
export function createUnattendedSession(ports: UnattendedSessionPorts): UnattendedSessionLoader {
  return (left) =>
    withRefreshLock(async (hold) => {
      if (!(await ports.allowed())) return null;
      const stored = await ports.load();
      if (stored === null) {
        ports.ledger.forget();
        return null;
      }
      const pair = ports.ledger.current(stored);
      if (pair.expiresAt - ports.now() > RENEW_WITHIN_MS) {
        if (pair.refreshToken !== stored.refreshToken) await keep(ports.save, pair);
        return toSession(pair);
      }
      const started = await startIfAllowed(ports.allowed, async () => {
        if (left !== undefined && left() <= 0) throw new Error(NO_TIME_TO_RENEW);
        return renew(ports, pair);
      });
      if (started === null) return null;
      hold(started.result);
      return toSession(await answerInTime(started.result));
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
 * @throws Error when the portal refused or could not be reached, or when the
 *   caller had no time left to renew; every caller treats that as a failed
 *   attempt.
 */
export const loadUnattendedSession: UnattendedSessionLoader = createUnattendedSession({
  allowed: loadBackgroundCaptureAllowed,
  load: loadConnection,
  save: saveConnection,
  refresh: refreshTokens,
  now: Date.now,
  ledger: processLedger,
});
