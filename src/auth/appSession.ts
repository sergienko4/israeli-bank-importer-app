/**
 * What the app does with a connection between sign-ins.
 *
 * Access tokens last minutes, refresh tokens last weeks. The rules here decide
 * when to spend a refresh token and what a failure means, and they are kept
 * apart from React so they can be reasoned about — and tested — without a
 * component around them.
 */
import { refreshTokens, SessionEndedError } from '../api/appTokens';
import type { Session } from '../api/importerClient';
import { answerInTime } from '../api/timedFetch';
import { authenticateBiometric } from '../lib/biometrics';
import { forgetHeldMessages } from '../lib/otpStashGate';
import {
  clearConnection,
  type Connection,
  loadConnection,
  saveConnection,
} from './connectionStore';
import { type HoldLock, withRefreshLock } from './refreshLock';
import { processLedger } from './tokenLedger';

/**
 * How long before expiry a token is refreshed rather than used.
 *
 * Two minutes covers a slow request that starts just before the deadline and
 * arrives just after it, which would otherwise fail with a 401 the user sees.
 */
export const REFRESH_MARGIN_MS = 120_000;

/** Why a renewal ended the connection when the device had already been unpaired. */
export const NO_LONGER_PAIRED = 'This device was disconnected. Connect again to continue.';

/** Why a renewal stopped when the saved pairing could not be read. */
export const STORAGE_UNREADABLE = 'Could not read the saved connection. Try again.';

/** Stands for a store that could not be read, apart from one that holds nothing. */
const UNREADABLE = Symbol('unreadable');

/**
 * What happened when the app tried to renew a connection.
 *
 * An ended renewal also says which sign-in it judged, counted from the start of
 * this process. It reaches the screen only after it returns, and a sign-in that
 * was already waiting on the refresh lock can save a new pairing in that gap;
 * handing `pairing` back to {@link dropConnection} lets the drop tell the two
 * apart.
 */
export type RefreshOutcome =
  | { status: 'refreshed'; connection: Connection }
  | { status: 'declined'; message: string }
  | { status: 'ended'; message: string; pairing: number };

/** Sign-ins adopted in this process; changed only under the refresh lock. */
let signIns = 0;

/**
 * Narrows a stored connection to what the API client needs.
 * @param connection - The stored connection.
 * @returns The session used to authorize requests.
 */
export function toSession(connection: Connection): Session {
  return { baseUrl: connection.baseUrl, token: connection.accessToken };
}

/**
 * Reports whether the access token is close enough to expiry to renew it.
 * @param connection - The stored connection.
 * @param now - Current time in epoch milliseconds.
 * @returns True when the token should be refreshed before the next request.
 */
export function isExpiring(connection: Connection, now: number = Date.now()): boolean {
  return connection.expiresAt - now < REFRESH_MARGIN_MS;
}

/**
 * Decides whether a refresh failure is worth retrying.
 *
 * A revoked, replayed, or expired refresh token is terminal and arrives as its
 * own type. Everything else — a dropped connection, a rate limit, a portal
 * restarting — is worth another attempt later, and must not sign the user out.
 * @param error - The failure the refresh call raised.
 * @returns `ended` when the session is gone for good, `declined` otherwise.
 */
function endedBy(error: unknown): 'ended' | 'declined' {
  return error instanceof SessionEndedError ? 'ended' : 'declined';
}

/**
 * Renews the stored connection behind a biometric prompt.
 *
 * The prompt is fail-closed: only an explicit success spends the refresh token,
 * so a phone picked up by someone else cannot quietly reach the importer.
 *
 * A device with no biometrics enrolled cannot protect a long-lived token at
 * all, so that case ends the connection instead of silently using it — the same
 * stance the previous version took with the stored password.
 *
 * It renews whatever storage holds when its turn on the refresh lock comes, not
 * the screen's copy: the background or a newer sign-in may have replaced that
 * copy while the prompt was up.
 * @returns What happened, including the renewed connection on success.
 */
export async function refreshConnection(): Promise<RefreshOutcome> {
  const pairing = signIns;
  const unlock = await authenticateBiometric('Unlock to reconnect to your importer');
  if (unlock.status === 'unsupported') {
    return { status: 'ended', message: 'Set up a screen lock to stay signed in.', pairing };
  }
  if (unlock.status !== 'success') {
    return { status: 'declined', message: 'Unlock to reconnect to your importer.' };
  }
  return withRefreshLock(async (hold) => renewLatest(hold));
}

/**
 * Reads the pair to renew from storage rather than from the screen's copy.
 *
 * The background capture renews on its own and saves the pair it was issued,
 * which retires the refresh token the screen loaded at launch, and a sign-in
 * may have replaced the whole pairing, so the stored pair wins. An empty store
 * means the device was unpaired while this renewal waited, and renewing would
 * quietly pair it again.
 *
 * A store that cannot be read is reported as such rather than answered with the
 * screen's copy, which may belong to a pairing that was since replaced.
 * @returns The stored pair, `null` when the device is no longer paired, or
 *   {@link UNREADABLE} when storage could not be read.
 */
async function latestStored(): Promise<Connection | null | typeof UNREADABLE> {
  try {
    return await loadConnection();
  } catch {
    return UNREADABLE;
  }
}

/**
 * Spends the live refresh token and saves the pair it buys.
 *
 * Storage can lag behind when a save failed after the portal had rotated, so
 * the process ledger decides which of this process's pairs is still live.
 *
 * The caller is answered on the usual deadline, but a reply that arrives later
 * is still recorded and saved under the lock: the portal retired the presented
 * token on accepting it, so that reply holds the only live one.
 *
 * Unreadable storage declines without spending anything: the user can retry,
 * whereas a token spent from the wrong pairing cannot be taken back.
 * @param hold - Keeps the lock until a late reply has been kept.
 * @returns What happened, including the renewed connection on success.
 */
async function renewLatest(hold: HoldLock): Promise<RefreshOutcome> {
  const pairing = signIns;
  const stored = await latestStored();
  if (stored === UNREADABLE) {
    return { status: 'declined', message: STORAGE_UNREADABLE };
  }
  if (stored === null) {
    return { status: 'ended', message: NO_LONGER_PAIRED, pairing };
  }
  const renewal = renewFrom(processLedger.current(stored));
  hold(renewal);
  try {
    return { status: 'refreshed', connection: await answerInTime(renewal) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Could not reconnect. Try again.';
    return endedBy(error) === 'ended'
      ? { status: 'ended', message, pairing }
      : { status: 'declined', message };
  }
}

/**
 * Presents a refresh token, then records and saves the pair it buys.
 * @param current - The pair whose refresh token is live.
 * @returns The renewed pair.
 */
async function renewFrom(current: Connection): Promise<Connection> {
  const tokens = await refreshTokens(current.baseUrl, current.refreshToken);
  const next: Connection = {
    baseUrl: current.baseUrl,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
  };
  processLedger.record(current, next);
  try {
    await saveConnection(next);
  } catch {
    // The old refresh token is already spent, so a failed write must not be
    // reported as a refusal: the caller keeps the rotated pair for this run
    // rather than replaying a token the portal has retired.
  }
  return next;
}

/**
 * Stores the pair a new sign-in was issued, replacing whatever was paired.
 *
 * Runs under the refresh lock, so a background renewal of the old pairing that
 * is still in flight cannot save over the new one when it finishes.
 *
 * Held messages are forgotten once the new pair is stored, still under the
 * lock: they were captured for the pairing this replaces, and work that queued
 * on the lock behind the sign-in would otherwise spend them against the new
 * one. Clearing before the save would let a code held in between survive.
 * @param connection - The address and tokens the sign-in produced.
 */
export async function adoptConnection(connection: Connection): Promise<void> {
  await withRefreshLock(async () => {
    await saveConnection(connection);
    processLedger.forget();
    signIns += 1;
    await forgetHeldMessages();
  });
}

/**
 * Removes the stored pairing, and the messages held for it.
 *
 * Runs under the refresh lock, so a renewal that is still in flight cannot save
 * the pairing back after the user removed it, and nothing queued behind the
 * drop can spend a code held for the pairing it removed.
 *
 * A drop that spares a newer sign-in leaves held messages alone: that sign-in
 * already forgot the old pairing's, so what is held now is its own.
 * @param pairing - The sign-in an ended renewal judged. When given, a pairing
 *   adopted since then is left alone; the user tapping Disconnect omits it.
 * @returns Whether the pairing was removed.
 */
export async function dropConnection(pairing?: number): Promise<boolean> {
  return withRefreshLock(async () => {
    if (pairing !== undefined && pairing !== signIns) return false;
    await clearConnection();
    processLedger.forget();
    await forgetHeldMessages();
    return true;
  });
}
