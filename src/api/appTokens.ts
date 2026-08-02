/**
 * The token pair the portal issues to this device, and the one call that keeps
 * it alive.
 *
 * Refresh tokens rotate: every successful refresh invalidates the token it was
 * given. Presenting a rotated token twice tells the portal that a copy escaped
 * the device, and it ends the whole session rather than guessing which holder
 * is genuine. That is why a 400 here means "sign in again" and never "retry".
 */
import { failureMessage, messageForStatus } from '../lib/errorMessages';
import { normalizeBaseUrl } from './importerClient';
import { timedFetch } from './timedFetch';

/**
 * What the portal says when a refresh token is revoked, replayed, or expired.
 *
 * Exported because callers have to tell this apart from a temporary failure:
 * retrying this one can never succeed, and a revoked device that keeps knocking
 * is not revoked.
 */
export const SESSION_ENDED = failureMessage('signed-out').text;

/**
 * Raised when the portal has ended this session for good.
 *
 * The type carries the meaning, not the sentence. Several unrelated failures
 * are worded the same way on purpose — a 401 anywhere reads as "sign in again"
 * — so matching on the text would make any of them look like a revoked refresh
 * token and sign the user out for something a retry would have fixed.
 */
export class SessionEndedError extends Error {
  /** Creates the error with the shared signed-out wording. */
  constructor() {
    super(SESSION_ENDED);
    this.name = 'SessionEndedError';
  }
}

/** Tokens returned by the portal after a successful app sign-in. */
export interface AppTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/**
 * Reports whether a lifetime can be turned into a usable deadline.
 *
 * A `NaN` lifetime would produce a `NaN` deadline, and every later comparison
 * against it reads as "not expiring" — so the app would keep an access token it
 * can no longer use and never renew it.
 * @param expiresIn - The lifetime the portal reported, in seconds.
 * @returns True when the value is a finite, positive number.
 */
function isUsableLifetime(expiresIn: unknown): expiresIn is number {
  return typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0;
}

/**
 * Validates a token response and stamps it with an absolute expiry.
 *
 * The portal sends a lifetime in seconds; the app stores a wall-clock deadline
 * so a refresh can be scheduled without tracking when the response arrived.
 *
 * This checks only the three fields the app uses, rather than the whole grant
 * the contract describes. An older importer that does not yet send every field
 * of a grant can still sign this device in, which a stricter check would
 * refuse for no benefit.
 * @param body - The parsed response body, not yet trusted.
 * @returns The validated tokens.
 * @throws Error when any field is missing or has the wrong type.
 */
export function toAppTokens(body: unknown): AppTokens {
  const { accessToken, refreshToken, expiresIn } = (body ?? {}) as Record<string, unknown>;
  const isUsable =
    typeof accessToken === 'string' &&
    accessToken.length > 0 &&
    typeof refreshToken === 'string' &&
    refreshToken.length > 0 &&
    isUsableLifetime(expiresIn);
  if (!isUsable) {
    throw new Error(failureMessage('unexpected-reply').text);
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
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
  const res = await timedFetch(`${normalizeBaseUrl(baseUrl)}/auth/app/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (res.status === 400) {
    throw new SessionEndedError();
  }
  if (res.status === 429) {
    throw new Error(failureMessage('too-busy').text);
  }
  if (!res.ok) {
    throw new Error(messageForStatus(res.status));
  }
  return toAppTokens(await res.json());
}
