/**
 * Minimal HTTP client for a self-hosted importer's portal API. Exchanges the
 * portal password for a bearer token and verifies a token against /auth/status.
 * All calls target the user's own importer over their private network.
 */

import type { ConfigObject, Manifest, SaveResult } from './manifest';
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

/**
 * Performs an authenticated request against the importer, attaching the bearer.
 * @param session - The active session.
 * @param path - The API path (e.g. `/api/config`).
 * @param init - Optional fetch init (method, body, headers).
 * @returns The fetch Response.
 */
async function authed(session: Session, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = {
    ...(init.headers as Record<string, string> | undefined),
    authorization: `Bearer ${session.token}`,
  };
  return fetch(`${normalizeBaseUrl(session.baseUrl)}${path}`, { ...init, headers });
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
