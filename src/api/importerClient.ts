/**
 * Minimal HTTP client for a self-hosted importer's portal API. Exchanges the
 * portal password for a bearer token and verifies a token against /auth/status.
 * All calls target the user's own importer over their private network.
 */

import type { ConfigObject, Manifest, SaveResult } from './manifest';
import type { OtpChannel, OtpSettings, PendingOtpRequest } from './otp';
import type { RunEntry } from './status';

/**
 * Normalizes a user-typed address to an origin with a scheme and no trailing
 * slash, so `host:8080`, `http://host:8080`, and `http://host:8080/` all resolve
 * to the same base.
 * @param input - The raw address the user typed.
 * @returns A normalized `scheme://host[:port]` base URL.
 */
export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

/**
 * Exchanges the portal password for a bearer token via `POST /auth/token`.
 * @param baseUrl - The importer address.
 * @param password - The portal password.
 * @returns The bearer token string.
 * @throws Error with a user-facing message on a wrong password, a server error,
 *   or an unexpected response body.
 */
export async function requestToken(baseUrl: string, password: string): Promise<string> {
  const res = await fetch(`${normalizeBaseUrl(baseUrl)}/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (res.status === 401) {
    throw new Error('Incorrect portal password.');
  }
  if (!res.ok) {
    throw new Error(`The importer returned an error (${String(res.status)}).`);
  }
  const data = (await res.json()) as { token?: unknown };
  if (typeof data.token !== 'string' || data.token.length === 0) {
    throw new Error('Unexpected response from the importer.');
  }
  return data.token;
}

/**
 * Reports whether a bearer token is currently authorized via `GET /auth/status`.
 * @param baseUrl - The importer address.
 * @param token - A bearer token previously issued by the importer.
 * @returns True when the importer reports the token as authorized.
 */
export async function checkAuthorized(baseUrl: string, token: string): Promise<boolean> {
  const res = await fetch(`${normalizeBaseUrl(baseUrl)}/auth/status`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    return false;
  }
  const data = (await res.json()) as { authorized?: unknown };
  return data.authorized === true;
}

/** An authenticated importer session (base URL + bearer token). */
export interface Session {
  baseUrl: string;
  token: string;
}

/** Produces a fresh session (e.g. by re-authenticating), or null when it cannot. */
export type ReauthHandler = () => Promise<Session | null>;

let reauthHandler: ReauthHandler | null = null;
let inFlightReauth: Promise<Session | null> | null = null;

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
 * On a 401 it attempts a single silent re-authentication and retries once with
 * the refreshed token, so an expired session recovers transparently.
 * @param session - The active session.
 * @param path - The API path (e.g. `/api/config`).
 * @param init - Optional fetch init (method, body, headers).
 * @returns The fetch Response.
 */
async function authed(session: Session, path: string, init: RequestInit = {}): Promise<Response> {
  const send = (active: Session): Promise<Response> =>
    fetch(`${normalizeBaseUrl(active.baseUrl)}${path}`, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        authorization: `Bearer ${active.token}`,
      },
    });
  const res = await send(session);
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
    throw new Error(`Could not load the manifest (${String(res.status)}).`);
  }
  return (await res.json()) as Manifest;
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
    throw new Error('Session expired. Please reconnect.');
  }
  if (!res.ok) {
    throw new Error(`Could not load the config (${String(res.status)}).`);
  }
  return (await res.json()) as ConfigObject;
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
    error: data.error ?? `Request failed (${String(res.status)}).`,
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
    throw new Error('Session expired. Please reconnect.');
  }
  if (!res.ok) {
    throw new Error(`Could not load status (${String(res.status)}).`);
  }
  const data = (await res.json()) as { runs?: RunEntry[] };
  return Array.isArray(data.runs) ? data.runs : [];
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
    throw new Error(`Could not load OTP settings (${String(res.status)}).`);
  }
  return (await res.json()) as OtpSettings;
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
    throw new Error(`Could not load pending OTP requests (${String(res.status)}).`);
  }
  const data = (await res.json()) as { requests?: PendingOtpRequest[] };
  return Array.isArray(data.requests) ? data.requests : [];
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
