/**
 * A `fetch` that gives up instead of waiting forever.
 *
 * The sign-in and refresh calls both gate the whole app: while either is
 * pending the user is looking at a spinner and every authenticated request is
 * queued behind it. An importer that accepts the connection and then never
 * answers would leave that state permanently, which is worse than a failure the
 * user can retry.
 */

/** Long enough for a slow home network, short enough to stay a wait. */
const REQUEST_TIMEOUT_MS = 15_000;

/** What the user sees when the importer accepted the request but never replied. */
export const NO_RESPONSE = 'The importer did not respond in time.';

/**
 * Sends a request that fails once the deadline passes.
 * @param url - The request URL.
 * @param init - The request options; any caller signal is replaced.
 * @returns The response, when one arrives in time.
 * @throws Error with {@link NO_RESPONSE} on timeout, or whatever `fetch` threw.
 */
export async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error: unknown) {
    throw controller.signal.aborted ? new Error(NO_RESPONSE) : error;
  } finally {
    clearTimeout(timeoutId);
  }
}
