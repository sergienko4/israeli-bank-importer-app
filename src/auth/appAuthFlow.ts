/**
 * Browser sign-in against the importer's portal.
 *
 * The app never sees the portal password. It sends the user to the portal in
 * the system browser, where they satisfy whatever the portal requires — Google,
 * a password, or both — and the portal hands back a one-time code on the app's
 * own scheme. The code is only useful together with the PKCE verifier this
 * module keeps in memory, so a malicious app that intercepts the redirect gains
 * nothing.
 *
 * The `state` value is compared before the code is used. A redirect carrying a
 * code we did not ask for is discarded without a network call.
 */
import * as Device from 'expo-device';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { type AppTokens, toAppTokens, type TokenBody } from '../api/appTokens';
import { normalizeBaseUrl } from '../api/importerClient';
import { timedFetch } from '../api/timedFetch';
import { failureMessage, messageForStatus } from '../lib/errorMessages';
import { createPkcePair, createState } from './pkce';

/** Where the portal sends the browser back to. Must match `expo.scheme`. */
export const REDIRECT_URI = 'bankimporter://auth';

/** What may follow the redirect target: a path, a query, or a fragment. */
const REDIRECT_BOUNDARIES = new Set(['/', '?', '#']);

/**
 * Reports whether a URL addresses this app's redirect and not a lookalike.
 *
 * A plain prefix test is not enough: `bankimporter://authorize.evil` starts
 * with the redirect target but names a different host, and the operating
 * system delivers it here all the same because the scheme matches. The
 * character after the prefix has to end the host for the URL to be ours.
 * @param url - The URL the browser handed back.
 * @returns True when the URL targets this app's redirect.
 */
function isOurRedirect(url: string): boolean {
  if (!url.startsWith(REDIRECT_URI)) {
    return false;
  }
  const next = url.charAt(REDIRECT_URI.length);
  return next === '' || REDIRECT_BOUNDARIES.has(next);
}

/** Device names are shown in the portal's session list, so they stay short. */
const DEVICE_NAME_MAX = 64;

/**
 * Names this device for the portal's session list.
 * @returns The device name, truncated, or a neutral fallback.
 */
function describeDevice(): string {
  const name = Device.deviceName ?? '';
  return name.length > 0 ? name.slice(0, DEVICE_NAME_MAX) : 'Mobile app';
}

/**
 * Builds the portal's authorization URL.
 * @param baseUrl - Normalized importer address.
 * @param challenge - PKCE S256 challenge.
 * @param state - Opaque CSRF value the portal echoes back.
 * @returns The URL to open in the system browser.
 */
function authorizeUrl(baseUrl: string, challenge: string, state: string): string {
  const params = new URLSearchParams({
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    device_name: describeDevice(),
  });
  return `${baseUrl}/auth/app/authorize?${params.toString()}`;
}

/**
 * Opens the portal in the system browser and waits for it to hand back.
 *
 * Only the redirect variant of the result carries a URL, so its presence is
 * what distinguishes a completed sign-in from a closed browser. That URL
 * arrives from the operating system rather than from this app, so its target is
 * checked before anything reads a parameter out of it.
 * @param url - The authorization URL.
 * @returns The redirect URL the browser returned.
 * @throws Error when the user backed out, the browser could not complete, or
 *   the URL handed back was not this app's redirect.
 */
async function awaitRedirect(url: string): Promise<string> {
  const result = await WebBrowser.openAuthSessionAsync(url, REDIRECT_URI);
  if ('url' in result) {
    if (!isOurRedirect(result.url)) {
      throw new Error('That sign-in did not come back from this importer. Start it again.');
    }
    return result.url;
  }
  const wasClosed =
    result.type === WebBrowser.WebBrowserResultType.CANCEL ||
    result.type === WebBrowser.WebBrowserResultType.DISMISS;
  throw new Error(
    wasClosed ? 'Sign-in was cancelled.' : 'The browser closed before sign-in finished. Try again.',
  );
}

/**
 * Reads a single query parameter, ignoring the repeated-value form.
 * @param params - Parsed query parameters.
 * @param key - Parameter name.
 * @returns The value, or an empty string when absent or repeated.
 */
function single(params: Record<string, string | string[] | undefined> | null, key: string): string {
  const value = params?.[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Extracts the authorization code from the redirect.
 *
 * The state is checked first: if it does not match, the redirect did not come
 * from the sign-in this app started, and its code is never sent anywhere.
 *
 * A reported error is answered with a fixed message. The value arrives from the
 * browser, so displaying it verbatim would let whatever opened that redirect
 * put arbitrary text in front of the user inside the app.
 * @param redirectUrl - The URL the browser handed back.
 * @param state - The state value this sign-in generated.
 * @returns The authorization code.
 * @throws Error when the portal reported a problem, the state does not match,
 *   or no code came back.
 */
function codeFrom(redirectUrl: string, state: string): string {
  const { queryParams } = Linking.parse(redirectUrl);
  const reported = single(queryParams, 'error');
  if (reported.length > 0) {
    throw new Error('The importer would not complete the sign-in. Try again.');
  }
  if (single(queryParams, 'state') !== state) {
    throw new Error('That sign-in did not come back from this importer. Start it again.');
  }
  const code = single(queryParams, 'code');
  if (code.length === 0) {
    throw new Error('The sign-in came back without a code. Start it again.');
  }
  return code;
}

/**
 * Turns a non-2xx token response into the message the user should see.
 * @param status - HTTP status returned by the portal.
 * @returns The error to throw.
 */
function tokenError(status: number): Error {
  // The importer returns 503 here only for app sign-in being switched off, and
  // the browser has just completed the same flow against the same origin, so a
  // 503 at this point is that setting rather than an importer that is down.
  if (status === 503) {
    return new Error('This importer has not turned on app sign-in. Enable it in the portal.');
  }
  if (status === 400) {
    return new Error('The sign-in took too long and expired. Start it again.');
  }
  if (status === 429) {
    return new Error(failureMessage('too-busy').text);
  }
  return new Error(messageForStatus(status));
}

/**
 * Redeems the authorization code for tokens.
 * @param baseUrl - Normalized importer address.
 * @param code - The authorization code.
 * @param verifier - The PKCE verifier that produced the challenge.
 * @returns The issued tokens.
 * @throws Error carrying a user-facing message when the portal refuses.
 */
async function redeem(baseUrl: string, code: string, verifier: string): Promise<AppTokens> {
  const res = await timedFetch(`${baseUrl}/auth/app/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: REDIRECT_URI }),
  });
  if (!res.ok) {
    throw tokenError(res.status);
  }
  return toAppTokens((await res.json()) as TokenBody);
}

/**
 * Runs the full browser sign-in and returns the token pair.
 *
 * The verifier exists only for the duration of this call and is never stored or
 * logged.
 * @param baseUrl - The importer address as the user typed it.
 * @returns The tokens the portal issued.
 * @throws Error carrying a message suitable for display.
 */
export async function signIn(baseUrl: string): Promise<AppTokens> {
  const base = normalizeBaseUrl(baseUrl);
  const { verifier, challenge } = await createPkcePair();
  const state = await createState();
  const redirectUrl = await awaitRedirect(authorizeUrl(base, challenge, state));
  const code = codeFrom(redirectUrl, state);
  return await redeem(base, code, verifier);
}
