/**
 * Minimal HTTP client for a self-hosted importer's portal API. Carries the
 * bearer token issued by browser sign-in and verifies it against /auth/status.
 * Every call goes over HTTPS, because a release build cannot make a plain-HTTP
 * request at all: Android has blocked cleartext by default since 9.
 */

import { failureMessage, messageForStatus } from '../lib/errorMessages';
import { REQUEST_TIMEOUT_MS, RequestTimeoutError, withRequestTimeout } from '../lib/requestTimeout';
import { type AuthedOptions, SubmissionCancelledError } from './authedTypes';
import { CONFIG_BODY, MANIFEST_BODY, OTP_SETTINGS, STATUS_BODY } from './generated';
import type { ConfigObject, Manifest, SaveResult } from './manifest';
import type { OtpChannel, OtpSettings, PendingOtpRequest } from './otp';
import { otpSubmission, type OtpSubmissionRequest } from './otpPayload';
import { pendingFrom } from './otpPending';
import { parsedBody } from './parseResponse';
import {
  markDeadline,
  readJsonOrEmpty,
  readJsonOrUndefined,
  readWithinDeadline,
} from './responseBody';
import type { Session } from './session';
import type { RunEntry } from './status';
import { timedFetch } from './timedFetch';
import { createWriteQueue, serializeWrite, withOtpLane } from './writeQueue';
export type { Session } from './session';

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
 * caller here puts a raised message straight in front of the user. A request
 * that outlives its deadline keeps the deadline's own wording: "unreachable"
 * would be a guess, while the deadline is a fact the user can act on. The
 * request is aborted and awaited briefly before the timeout is raised. A
 * transport that ignores its abort cannot hold the lane forever, though only
 * the importer can guarantee ordering once a timed-out write is still running.
 * @param send - Performs the request with the abort signal.
 * @returns The response, when the importer answered at all.
 * @throws Error naming the importer as unreachable when it did not, or a
 * {@link RequestTimeoutError} when it never answered in time.
 */
async function reachable(send: (signal: AbortSignal) => Promise<Response>): Promise<Response> {
  const controller = new AbortController();
  const deadlineAt = Date.now() + REQUEST_TIMEOUT_MS;
  const request = send(controller.signal);
  const timedOut = { current: false };
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(
      () => {
        timedOut.current = true;
        controller.abort();
        reject(new RequestTimeoutError());
      },
      Math.max(0, deadlineAt - Date.now()),
    );
  });
  try {
    const res = await Promise.race([request, deadline]);
    markDeadline(res, deadlineAt, controller);
    return res;
  } catch {
    if (timedOut.current) {
      // Aborting can reject the request before the deadline's rejection is
      // observed. The flag keeps that race from masquerading as a transport
      // failure. Wait briefly for the abort to settle, but never on a
      // transport that ignores it: that would hold the caller past its budget.
      await withRequestTimeout(
        request.catch(() => undefined),
        1_000,
      ).catch(() => undefined);
      throw new RequestTimeoutError();
    }
    throw new Error(failureMessage('unreachable').text);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
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
  const res = await reachable((signal) =>
    fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      signal,
    }),
  );
  if (!res.ok) {
    return false;
  }
  const authStatus = await readJsonOrUndefined(res);
  return (authStatus as { authorized?: unknown } | undefined)?.authorized === true;
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
  const handler = reauthHandler;
  if (!handler) {
    return null;
  }
  inFlightReauth ??= Promise.resolve()
    .then(() => handler())
    .catch(() => null)
    .finally(() => {
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
 * `signal` is excluded from `init` so this function can attach the deadline's
 * own abort signal; the retry reuses `init`, and a body must therefore be a
 * value that can be sent twice, such as a string.
 * @param session - The active session.
 * @param path - The API path (e.g. `/api/config`).
 * @param options - Optional fetch init and before-send gate.
 * @returns The fetch Response.
 */
async function authedRequest(
  session: Session,
  path: string,
  options: AuthedOptions = {},
): Promise<Response> {
  const { init = {}, beforeSend } = options;
  const send = async (active: Session): Promise<Response> => {
    // Built before the guard so a rejected address keeps its own wording.
    const url = `${normalizeBaseUrl(active.baseUrl)}${path}`;
    const start = (): Promise<Response> =>
      reachable((signal) =>
        fetch(url, {
          ...init,
          signal,
          headers: {
            ...(init.headers as Record<string, string> | undefined),
            authorization: `Bearer ${active.token}`,
          },
        }),
      );
    return beforeSend ? beforeSend(start) : start();
  };
  const current = sessionGuard ? await sessionGuard(session).catch(() => session) : session;
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
  const res = await authedRequest(session, '/api/manifest');
  if (!res.ok) {
    throw new Error(messageForStatus(res.status));
  }
  return readWithinDeadline(res, () => parsedBody(res, MANIFEST_BODY));
}

/**
 * Loads the current (masked) importer config.
 * @param session - The active session.
 * @returns The config object.
 * @throws Error when unauthorized or the request fails.
 */
export async function getConfig(session: Session): Promise<ConfigObject> {
  const res = await authedRequest(session, '/api/config');
  if (res.status === 401) {
    throw new Error(failureMessage('signed-out').text);
  }
  if (!res.ok) {
    throw new Error(messageForStatus(res.status));
  }
  return readWithinDeadline(res, () => parsedBody(res, CONFIG_BODY));
}

/**
 * Reads a non-ok response body defensively into a failure result.
 * @param res - A non-ok response.
 * @returns A failure SaveResult with the importer's message + errors when present.
 */
async function toFailure(res: Response): Promise<SaveResult> {
  const data = await readJsonOrEmpty(res);
  return {
    ok: false,
    error: data.error ?? messageForStatus(res.status),
    errors: data.errors,
    status: res.status,
  };
}

/** Serializes config writes so an older save cannot overwrite a newer one. */
const configWrites = createWriteQueue();
/** Device-token registration, independent of config saves. */
const deviceWrites = createWriteQueue();
/** OTP delivery settings, a separate resource from the config document. */
const otpSettingsWrites = createWriteQueue();
/**
 * Persists a full config via `PUT /api/config`, surfacing validation errors.
 * @param session - The active session.
 * @param config - The config object to save.
 * @returns Success, or a failure carrying the importer's validation errors.
 */
export function saveConfig(session: Session, config: ConfigObject): Promise<SaveResult> {
  return serializeWrite(configWrites, async () => {
    const res = await authedRequest(session, '/api/config', {
      init: {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(config),
      },
    });
    return res.ok ? { ok: true } : toFailure(res);
  });
}

/**
 * Removes a bank via `DELETE /api/banks/:name`.
 * @param session - The active session.
 * @param name - The bank id to remove.
 * @returns Success or a failure with validation errors.
 */
export function removeBank(session: Session, name: string): Promise<SaveResult> {
  return serializeWrite(configWrites, async () => {
    const res = await authedRequest(session, `/api/banks/${encodeURIComponent(name)}`, {
      init: { method: 'DELETE' },
    });
    return res.ok ? { ok: true } : toFailure(res);
  });
}

/**
 * Loads the recent import runs (redacted per-bank summaries) via `GET /api/status`.
 * @param session - The active session.
 * @returns The recent runs, most recent last (may be empty).
 * @throws Error when unauthorized or the request fails.
 */
export async function getStatus(session: Session): Promise<RunEntry[]> {
  const res = await authedRequest(session, '/api/status');
  if (res.status === 401) {
    throw new Error(failureMessage('signed-out').text);
  }
  if (!res.ok) {
    throw new Error(messageForStatus(res.status));
  }
  const statusBody = await readWithinDeadline(res, () => parsedBody(res, STATUS_BODY));
  return statusBody.runs;
}

/**
 * Registers this device's Expo push token via `POST /api/devices`.
 * @param session - The active session.
 * @param token - The Expo push token.
 * @returns Success or a failure carrying the importer's error.
 */
export function registerDevice(session: Session, token: string): Promise<SaveResult> {
  return serializeWrite(deviceWrites, async () => {
    const res = await authedRequest(session, '/api/devices', {
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      },
    });
    return res.ok ? { ok: true } : toFailure(res);
  });
}

/**
 * Unregisters this device's Expo push token via `DELETE /api/devices`.
 * @param session - The active session.
 * @param token - The Expo push token.
 * @returns Success or a failure carrying the importer's error.
 */
export function unregisterDevice(session: Session, token: string): Promise<SaveResult> {
  return serializeWrite(deviceWrites, async () => {
    const res = await authedRequest(session, '/api/devices', {
      init: {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      },
    });
    return res.ok ? { ok: true } : toFailure(res);
  });
}

/**
 * Reads the app-only OTP delivery settings via `GET /api/otp/settings`.
 * @param session - The active session.
 * @returns The OTP settings (channel).
 * @throws Error when the request fails.
 */
export async function getOtpSettings(session: Session): Promise<OtpSettings> {
  const res = await authedRequest(session, '/api/otp/settings');
  if (!res.ok) {
    throw new Error(messageForStatus(res.status));
  }
  return readWithinDeadline(res, () => parsedBody(res, OTP_SETTINGS));
}

/**
 * Sets the OTP delivery channel via `PUT /api/otp/settings`.
 * @param session - The active session.
 * @param channel - The channel to select (`telegram` or `app`).
 * @returns Success or a failure carrying the importer's error.
 */
export function setOtpSettings(session: Session, channel: OtpChannel): Promise<SaveResult> {
  return serializeWrite(otpSettingsWrites, async () => {
    const res = await authedRequest(session, '/api/otp/settings', {
      init: {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel }),
      },
    });
    return res.ok ? { ok: true } : toFailure(res);
  });
}

/**
 * Sends one OTP code, re-checking the caller's gate after every wait.
 * @param request - The session, request id, code, and before-send gate.
 * @returns The importer's answer, or null when the gate withdrew it.
 */
export function submitOtp({
  session,
  id,
  code,
  beforeSend,
}: OtpSubmissionRequest): Promise<SaveResult | null> {
  return withOtpLane(id, async () => {
    const { path, init } = otpSubmission(id, code);
    try {
      const res = await authedRequest(session, path, { init, beforeSend });
      return res.ok ? { ok: true } : await toFailure(res);
    } catch (error) {
      if (error instanceof SubmissionCancelledError) {
        return null;
      }
      throw error;
    }
  });
}

/**
 * Sends one request for work that runs while nobody is at the screen.
 *
 * It skips the screen's guard and its 401 recovery, because both can end in a
 * biometric prompt, and a prompt with no activity to show on never calls back.
 * The caller renewed the session without a prompt beforehand, so a 401 here is
 * a plain answer. The deadline matters for the same reason: Android freezes a
 * background task that is still waiting, with the code still undelivered.
 * @param session - A session the caller already made current.
 * @param request - The API path (e.g. `/api/otp/pending`) and fetch init.
 * @param read - Turns the response into the result, inside the same deadline.
 * @returns Whatever `read` returns, when the whole reply arrives in time.
 * @throws Error when the importer is unreachable or does not answer in time.
 */
async function unattended<T>(
  session: Session,
  { path, init }: { readonly path: string; readonly init: RequestInit },
  read: (res: Response) => Promise<T>,
): Promise<T> {
  const url = `${normalizeBaseUrl(session.baseUrl)}${path}`;
  const bearer = `Bearer ${session.token}`;
  return timedFetch(
    url,
    {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), authorization: bearer },
    },
    read,
  );
}

/**
 * Loads the pending OTP requests via `GET /api/otp/pending`.
 * @param session - The active session.
 * @returns The pending requests (may be empty); never carries codes.
 * @throws Error when the request fails.
 */
export async function getPendingOtp(session: Session): Promise<PendingOtpRequest[]> {
  return pendingFrom(await authedRequest(session, '/api/otp/pending'));
}

/**
 * Loads the pending OTP requests from background work, with no prompt behind it.
 * @param session - A session renewed without a prompt.
 * @returns The pending requests (may be empty); never carries codes.
 * @throws Error when the request fails or runs out of time.
 */
export async function getPendingOtpUnattended(session: Session): Promise<PendingOtpRequest[]> {
  return unattended(session, { path: '/api/otp/pending', init: {} }, pendingFrom);
}

/**
 * Submits an OTP code from background work, with no prompt behind it.
 * @param session - A session renewed without a prompt.
 * @param id - The pending request id.
 * @param code - The OTP code read from the SMS.
 * @returns Success or a failure carrying the importer's error.
 * @throws Error when the importer is unreachable or does not answer in time.
 */
export function submitOtpUnattended(
  session: Session,
  id: string,
  code: string,
): Promise<SaveResult> {
  return unattended(session, otpSubmission(id, code), async (res) =>
    res.ok ? { ok: true } : toFailure(res),
  );
}
