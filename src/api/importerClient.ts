/**
 * Minimal HTTP client for a self-hosted importer's portal API. Carries the
 * bearer token issued by browser sign-in and verifies it against /auth/status.
 * Every call goes over HTTPS, because a release build cannot make a plain-HTTP
 * request at all: Android has blocked cleartext by default since 9.
 */

import { failureMessage, messageForStatus } from '../lib/errorMessages';
import {
  CONFIG_BODY,
  MANIFEST_BODY,
  OTP_SETTINGS,
  PENDING_OTP_BODY,
  STATUS_BODY,
} from './generated';
import type { ConfigObject, Manifest, SaveResult } from './manifest';
import type { OtpChannel, OtpSettings, PendingOtpRequest } from './otp';
import { parsedBody } from './parseResponse';
import type { RunEntry } from './status';

const HTTPS = 'https://';

/**
 * Removes the trailing slashes a typed address often carries.
 *
 * Written as a scan rather than a `\/+$` replace: the address is user input,
 * and that pattern makes the engine backtrack over a long run of slashes.
 * @param value - The address, already trimmed of surrounding whitespace.
 * @returns The address without any trailing slash.
 */
function withoutTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charAt(end - 1) === '/') {
    end -= 1;
  }
  return value.slice(0, end);
}

/**
 * Normalizes a user-typed address to an origin with a scheme and no trailing
 * slash, so `host:8080`, `https://host:8080`, and `https://host:8080/` all
 * resolve to the same base.
 *
 * HTTPS is the only accepted scheme. The portal is reached through a proxy that
 * terminates TLS, such as `tailscale serve`, and a release build could not make
 * a plain-HTTP request anyway without switching off a platform protection that
 * shipped code has no business switching off.
 * @param input - The raw address the user typed.
 * @returns A normalized `https://host[:port]` base URL.
 * @throws Error when the address asks for plain HTTP.
 */
export function normalizeBaseUrl(input: string): string {
  const trimmed = withoutTrailingSlashes(input.trim());
  const lowered = trimmed.toLowerCase();
  if (lowered.startsWith('http://')) {
    throw new Error('Start the address with https:// so the connection stays private.');
  }
  const rest = lowered.startsWith(HTTPS) ? trimmed.slice(HTTPS.length) : trimmed;
  return `${HTTPS}${rest}`;
}

/**
 * Runs a request, replacing a transport failure with wording worth reading.
 *
 * A dropped connection arrives as whatever the platform calls it, and every
 * caller here puts a raised message straight in front of the user.
 * @param send - Performs the request.
 * @returns The response, when the importer answered at all.
 * @throws Error naming the importer as unreachable when it did not.
 */
async function reachable(send: () => Promise<Response>): Promise<Response> {
  try {
    return await send();
  } catch {
    throw new Error(failureMessage('unreachable').text);
  }
}

/**
 * Reports whether a bearer token is currently authorized via `GET /auth/status`.
 *
 * This one stays a question rather than a contract parse, and reads only the
 * single field it depends on. An importer that answers with something this app
 * does not recognise has not said the token is good, so the answer is no —
 * where a full-shape check would refuse an older importer that simply omits a
 * field this call never looks at, and sign the user out for nothing.
 * @param baseUrl - The importer address.
 * @param token - A bearer token previously issued by the importer.
 * @returns True when the importer reports the token as authorized.
 */
export async function checkAuthorized(baseUrl: string, token: string): Promise<boolean> {
  const url = `${normalizeBaseUrl(baseUrl)}/auth/status`;
  const res = await reachable(() =>
    fetch(url, {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  if (!res.ok) {
    return false;
  }
  const data: unknown = await res.json().catch(() => undefined);
  return (data as { authorized?: unknown } | undefined)?.authorized === true;
}

/** An authenticated importer session (base URL + bearer token). */
export interface Session {
  baseUrl: string;
  token: string;
}

/** Produces a fresh session (e.g. by re-authenticating), or null when it cannot. */
export type ReauthHandler = () => Promise<Session | null>;

/** Renews a session that is about to expire, or returns it unchanged. */
export type SessionGuard = (session: Session) => Promise<Session>;

let reauthHandler: ReauthHandler | null = null;
let inFlightReauth: Promise<Session | null> | null = null;
let sessionGuard: SessionGuard | null = null;

/**
 * Registers (or clears) the handler used to silently re-authenticate when a
 * request returns 401. The auth layer sets this so the client can recover from
 * an expired token without the caller handling it.
 * @param handler - The reauth handler, or null to clear it.
 */
export function setReauthHandler(handler: ReauthHandler | null): void {
  reauthHandler = handler;
}

/**
 * Registers (or clears) the check that runs before every authenticated request.
 *
 * Screens hold on to the session they rendered with, so without this the first
 * call after a token expires would fail with a 401 the user can see flicker
 * past. Renewing beforehand keeps that invisible.
 * @param guard - The guard, or null to clear it.
 */
export function setSessionGuard(guard: SessionGuard | null): void {
  sessionGuard = guard;
}

/**
 * Runs the reauth handler, de-duplicating concurrent 401s so only one
 * re-authentication is attempted at a time.
 * @returns A fresh session, or null when reauth is unavailable or fails.
 */
async function tryReauth(): Promise<Session | null> {
  if (!reauthHandler) {
    return null;
  }
  inFlightReauth ??= reauthHandler().finally(() => {
    inFlightReauth = null;
  });
  return inFlightReauth;
}

/**
 * Performs an authenticated request against the importer, attaching the bearer.
 *
 * A session close to expiry is renewed first. On a 401 it attempts a single
 * silent re-authentication and retries once, so a session that expired sooner
 * than expected still recovers without the caller handling it. The retry reuses
 * `init`, so a body must be a value that can be sent twice, such as a string.
 *
 * `signal` is excluded: {@link reachable} reads any rejection as an importer it
 * could not reach, which a cancelled request is not. Adding cancellation means
 * teaching that function to tell the two apart first.
 * @param session - The active session.
 * @param path - The API path (e.g. `/api/config`).
 * @param init - Optional fetch init (method, body, headers).
 * @returns The fetch Response.
 */
async function authed(
  session: Session,
  path: string,
  init: Omit<RequestInit, 'signal'> = {},
): Promise<Response> {
  const send = async (active: Session): Promise<Response> => {
    // Built before the guard so a rejected address keeps its own wording.
    const url = `${normalizeBaseUrl(active.baseUrl)}${path}`;
    return reachable(() =>
      fetch(url, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          authorization: `Bearer ${active.token}`,
        },
      }),
    );
  };
  const current = sessionGuard ? await sessionGuard(session) : session;
  const res = await send(current);
  if (res.status !== 401) {
    return res;
  }
  const refreshed = await tryReauth();
  return refreshed ? send(refreshed) : res;
}

/**
 * Loads the config manifest (sections, banks, per-bank requirements).
 * @param session - The active session.
 * @returns The manifest.
 * @throws Error when the request fails.
 */
export async function getManifest(session: Session): Promise<Manifest> {
  const res = await authed(session, '/api/manifest');
  if (!res.ok) {
    throw new Error(messageForStatus(res.status));
  }
  return parsedBody(res, MANIFEST_BODY);
}

/**
 * Loads the current (masked) importer config.
 * @param session - The active session.
 * @returns The config object.
 * @throws Error when unauthorized or the request fails.
 */
export async function getConfig(session: Session): Promise<ConfigObject> {
  const res = await authed(session, '/api/config');
  if (res.status === 401) {
    throw new Error(failureMessage('signed-out').text);
  }
  if (!res.ok) {
    throw new Error(messageForStatus(res.status));
  }
  return parsedBody(res, CONFIG_BODY);
}

/**
 * Reads a non-ok response body defensively into a failure result.
 * @param res - A non-ok response.
 * @returns A failure SaveResult with the importer's message + errors when present.
 */
async function toFailure(res: Response): Promise<SaveResult> {
  const data = (await res.json().catch(() => ({}))) as { error?: string; errors?: string[] };
  return {
    ok: false,
    error: data.error ?? messageForStatus(res.status),
    errors: data.errors,
  };
}

/**
 * Persists a full config via `PUT /api/config`, surfacing validation errors.
 * @param session - The active session.
 * @param config - The config object to save.
 * @returns Success, or a failure carrying the importer's validation errors.
 */
export async function saveConfig(session: Session, config: ConfigObject): Promise<SaveResult> {
  const res = await authed(session, '/api/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  });
  return res.ok ? { ok: true } : toFailure(res);
}

/**
 * Removes a bank via `DELETE /api/banks/:name`.
 * @param session - The active session.
 * @param name - The bank id to remove.
 * @returns Success or a failure with validation errors.
 */
export async function removeBank(session: Session, name: string): Promise<SaveResult> {
  const res = await authed(session, `/api/banks/${encodeURIComponent(name)}`, { method: 'DELETE' });
  return res.ok ? { ok: true } : toFailure(res);
}

/**
 * Loads the recent import runs (redacted per-bank summaries) via `GET /api/status`.
 * @param session - The active session.
 * @returns The recent runs, most recent last (may be empty).
 * @throws Error when unauthorized or the request fails.
 */
export async function getStatus(session: Session): Promise<RunEntry[]> {
  const res = await authed(session, '/api/status');
  if (res.status === 401) {
    throw new Error(failureMessage('signed-out').text);
  }
  if (!res.ok) {
    throw new Error(messageForStatus(res.status));
  }
  const data = await parsedBody(res, STATUS_BODY);
  return data.runs;
}

/**
 * Registers this device's Expo push token via `POST /api/devices`.
 * @param session - The active session.
 * @param token - The Expo push token.
 * @returns Success or a failure carrying the importer's error.
 */
export async function registerDevice(session: Session, token: string): Promise<SaveResult> {
  const res = await authed(session, '/api/devices', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  return res.ok ? { ok: true } : toFailure(res);
}

/**
 * Unregisters this device's Expo push token via `DELETE /api/devices`.
 * @param session - The active session.
 * @param token - The Expo push token.
 * @returns Success or a failure carrying the importer's error.
 */
export async function unregisterDevice(session: Session, token: string): Promise<SaveResult> {
  const res = await authed(session, '/api/devices', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  return res.ok ? { ok: true } : toFailure(res);
}

/**
 * Reads the app-only OTP delivery settings via `GET /api/otp/settings`.
 * @param session - The active session.
 * @returns The OTP settings (channel).
 * @throws Error when the request fails.
 */
export async function getOtpSettings(session: Session): Promise<OtpSettings> {
  const res = await authed(session, '/api/otp/settings');
  if (!res.ok) {
    throw new Error(messageForStatus(res.status));
  }
  return parsedBody(res, OTP_SETTINGS);
}

/**
 * Sets the OTP delivery channel via `PUT /api/otp/settings`.
 * @param session - The active session.
 * @param channel - The channel to select (`telegram` or `app`).
 * @returns Success or a failure carrying the importer's error.
 */
export async function setOtpSettings(session: Session, channel: OtpChannel): Promise<SaveResult> {
  const res = await authed(session, '/api/otp/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channel }),
  });
  return res.ok ? { ok: true } : toFailure(res);
}

/**
 * Loads the pending OTP requests via `GET /api/otp/pending`.
 * @param session - The active session.
 * @returns The pending requests (may be empty); never carries codes.
 * @throws Error when the request fails.
 */
export async function getPendingOtp(session: Session): Promise<PendingOtpRequest[]> {
  const res = await authed(session, '/api/otp/pending');
  if (!res.ok) {
    throw new Error(messageForStatus(res.status));
  }
  const data = await parsedBody(res, PENDING_OTP_BODY);
  return data.requests;
}

/**
 * Submits an OTP code for a pending request via `POST /api/otp/:id`.
 * @param session - The active session.
 * @param id - The pending request id.
 * @param code - The OTP code entered by the user.
 * @returns Success or a failure carrying the importer's error.
 */
export async function submitOtp(session: Session, id: string, code: string): Promise<SaveResult> {
  const res = await authed(session, `/api/otp/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  return res.ok ? { ok: true } : toFailure(res);
}
