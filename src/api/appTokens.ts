/**
 * The token pair the portal issues to this device, and the one call that keeps
 * it alive.
 *
 * Refresh tokens rotate: every successful refresh invalidates the token it was
 * given. Presenting a rotated token twice tells the portal that a copy escaped
 * the device, and it ends the whole session rather than guessing which holder
 * is genuine. That is why a 400 here means "sign in again" and never "retry".
 */
import { normalizeBaseUrl } from './importerClient';

/** Tokens returned by the portal after a successful app sign-in. */
export interface AppTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  sessionId: string;
}

/** The token payload shape, before any of it is trusted. */
export interface TokenBody {
  accessToken?: unknown;
  refreshToken?: unknown;
  expiresIn?: unknown;
  sessionId?: unknown;
}

/**
 * Validates a token response and stamps it with an absolute expiry.
 *
 * The portal sends a lifetime in seconds; the app stores a wall-clock deadline
 * so a refresh can be scheduled without tracking when the response arrived.
 * @param body - The parsed response body.
 * @returns The validated tokens.
 * @throws Error when any field is missing or has the wrong type.
 */
export function toAppTokens(body: TokenBody): AppTokens {
  const { accessToken, refreshToken, expiresIn, sessionId } = body;
  const isUsable =
    typeof accessToken === 'string' &&
    accessToken.length > 0 &&
    typeof refreshToken === 'string' &&
    refreshToken.length > 0 &&
    typeof expiresIn === 'number' &&
    typeof sessionId === 'string';
  if (!isUsable) {
    throw new Error('Unexpected response from the importer.');
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    sessionId,
  };
}

/**
 * Exchanges a refresh token for a new token pair.
 * @param baseUrl - The importer address.
 * @param refreshToken - The refresh token last issued to this device.
 * @returns The rotated token pair.
 * @throws Error carrying a user-facing message. A 400 is terminal: the caller
 *   must clear the stored connection rather than retry.
 */
export async function refreshTokens(baseUrl: string, refreshToken: string): Promise<AppTokens> {
  const res = await fetch(`${normalizeBaseUrl(baseUrl)}/auth/app/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (res.status === 400) {
    throw new Error('Session expired. Please sign in again.');
  }
  if (res.status === 429) {
    throw new Error('Too many attempts. Wait a minute and try again.');
  }
  if (!res.ok) {
    throw new Error(`The importer returned an error (${String(res.status)}).`);
  }
  return toAppTokens((await res.json()) as TokenBody);
}
