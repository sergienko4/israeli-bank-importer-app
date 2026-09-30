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
import { authenticateBiometric } from '../lib/biometrics';
import { type Connection, loadConnection, saveConnection } from './connectionStore';
import { withRefreshLock } from './refreshLock';

/**
 * How long before expiry a token is refreshed rather than used.
 *
 * Two minutes covers a slow request that starts just before the deadline and
 * arrives just after it, which would otherwise fail with a 401 the user sees.
 */
export const REFRESH_MARGIN_MS = 120_000;

/** What happened when the app tried to renew a connection. */
export type RefreshOutcome =
  | { status: 'refreshed'; connection: Connection }
  | { status: 'declined'; message: string }
  | { status: 'ended'; message: string };

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
 * Renews a connection behind a biometric prompt.
 *
 * The prompt is fail-closed: only an explicit success spends the refresh token,
 * so a phone picked up by someone else cannot quietly reach the importer.
 *
 * A device with no biometrics enrolled cannot protect a long-lived token at
 * all, so that case ends the connection instead of silently using it — the same
 * stance the previous version took with the stored password.
 * @param connection - The stored connection.
 * @returns What happened, including the renewed connection on success.
 */
export async function refreshConnection(connection: Connection): Promise<RefreshOutcome> {
  const unlock = await authenticateBiometric('Unlock to reconnect to your importer');
  if (unlock.status === 'unsupported') {
    return { status: 'ended', message: 'Set up a screen lock to stay signed in.' };
  }
  if (unlock.status !== 'success') {
    return { status: 'declined', message: 'Unlock to reconnect to your importer.' };
  }
  return withRefreshLock(async () => renewLatest(connection));
}

/**
 * Reads the pair to renew from storage rather than from the screen's copy.
 *
 * The background capture renews on its own and saves the pair it was issued,
 * which retires the refresh token the screen loaded at launch. Presenting that
 * retired token would look like a stolen copy and end the session, so the
 * stored pair wins whenever there is one.
 * @param connection - The screen's copy, used only when storage has none.
 * @returns The pair whose refresh token is still unspent.
 */
async function latestStored(connection: Connection): Promise<Connection> {
  try {
    return (await loadConnection()) ?? connection;
  } catch {
    return connection;
  }
}

/**
 * Spends the newest stored refresh token and saves the pair it buys.
 * @param connection - The screen's copy of the connection.
 * @returns What happened, including the renewed connection on success.
 */
async function renewLatest(connection: Connection): Promise<RefreshOutcome> {
  const current = await latestStored(connection);
  let next: Connection;
  try {
    const tokens = await refreshTokens(current.baseUrl, current.refreshToken);
    next = {
      baseUrl: current.baseUrl,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Could not reconnect. Try again.';
    return { status: endedBy(error), message };
  }
  try {
    await saveConnection(next);
  } catch {
    // The old refresh token is already spent, so a failed write must not be
    // reported as a refusal: the caller keeps the rotated pair for this run
    // rather than replaying a token the portal has retired.
  }
  return { status: 'refreshed', connection: next };
}
