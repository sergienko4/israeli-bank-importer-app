/**
 * Minimal HTTP client for a self-hosted importer's portal API. Exchanges the
 * portal password for a bearer token and verifies a token against /auth/status.
 * All calls target the user's own importer over their private network.
 */

import type { ConfigObject, Manifest, SaveResult } from './manifest';
import type { OtpChannel, OtpSettings, PendingOtpRequest } from './otp';
import type { RunEntry } from './status';

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
 * Extracts the host from an address that already carries a scheme.
 *
 * Written as a scan for the same reason as {@link withoutTrailingSlashes}: the
 * address is user input, and a URL-shaped pattern is easy to make backtrack.
 * @param address - An address beginning with `http://` or `https://`.
 * @returns The lowercased host, without the port.
 */
function hostOf(address: string): string {
  const afterScheme = address.slice(address.indexOf('://') + 3);
  if (afterScheme.startsWith('[')) {
    const close = afterScheme.indexOf(']');
    return (close === -1 ? afterScheme : afterScheme.slice(0, close + 1)).toLowerCase();
  }
  let end = afterScheme.length;
  for (let index = 0; index < afterScheme.length; index += 1) {
    const char = afterScheme.charAt(index);
    if (char === '/' || char === ':') {
      end = index;
      break;
    }
  }
  return afterScheme.slice(0, end).toLowerCase();
}

/**
 * Parses a dotted-quad IPv4 address.
 * @param host - The host to parse.
 * @returns The four octets, or null when the host is not an IPv4 literal.
 */
function octetsOf(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4) {
    return null;
  }
  const octets: number[] = [];
  for (const part of parts) {
    if (part.length === 0 || part.length > 3) {
      return null;
    }
    let value = 0;
    for (const char of part) {
      const digit = char.charCodeAt(0) - 48;
      if (digit < 0 || digit > 9) {
        return null;
      }
      value = value * 10 + digit;
    }
    if (value > 255) {
      return null;
    }
    octets.push(value);
  }
  return octets;
}

/**
 * Reports whether an IPv4 literal sits in a range that cannot be routed off the
 * user's own network.
 *
 * `100.64.0.0/10` is the range Tailscale assigns, so reaching a node by its
 * tailnet IP keeps working without a certificate.
 * @param octets - The four octets of the address.
 * @returns True when the address is loopback, RFC1918, or CGNAT.
 */
function isPrivateIPv4(octets: number[]): boolean {
  const [first, second] = octets;
  if (first === 127 || first === 10) {
    return true;
  }
  if (first === 172) {
    return second >= 16 && second <= 31;
  }
  if (first === 192) {
    return second === 168;
  }
  return first === 100 && second >= 64 && second <= 127;
}

/**
 * Reports whether plain HTTP is acceptable for a host.
 * @param host - The lowercased host.
 * @returns True when the host cannot leave the user's own network.
 */
function isPrivateHost(host: string): boolean {
  if (host === 'localhost' || host === '::1' || host === '[::1]') {
    return true;
  }
  const octets = octetsOf(host);
  return octets ? isPrivateIPv4(octets) : false;
}

/**
 * Normalizes a user-typed address to an origin with a scheme and no trailing
 * slash, so `host:8080`, `https://host:8080`, and `https://host:8080/` all
 * resolve to the same base.
 *
 * The default scheme is HTTPS because the portal is reached over
 * `tailscale serve`, which terminates TLS. Plain HTTP is still accepted for
 * addresses that cannot leave the user's own network, so local development and
 * direct tailnet IPs keep working; anywhere else it would put the tokens on the
 * wire in clear text.
 * @param input - The raw address the user typed.
 * @returns A normalized `scheme://host[:port]` base URL.
 * @throws Error when plain HTTP is used for a host outside a private network.
 */
export function normalizeBaseUrl(input: string): string {
  const trimmed = withoutTrailingSlashes(input.trim());
  const lowered = trimmed.toLowerCase();
  if (lowered.startsWith('https://')) {
    return trimmed;
  }
  if (!lowered.startsWith('http://')) {
    return `https://${trimmed}`;
  }
  if (isPrivateHost(hostOf(trimmed))) {
    return trimmed;
  }
  throw new Error('Use https:// for addresses outside your home network.');
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
 * than expected still recovers without the caller handling it.
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
