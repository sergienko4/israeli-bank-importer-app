/**
 * A `fetch` that gives up instead of waiting forever.
 *
 * The sign-in and refresh calls both gate the whole app: while either is
 * pending the user is looking at a spinner and every authenticated request is
 * queued behind it. An importer that accepts the connection and then never
 * answers would leave that state permanently, which is worse than a failure the
 * user can retry.
 */
import { failureMessage } from '../lib/errorMessages';

/** Long enough for a slow home network, short enough to stay a wait. */
const REQUEST_TIMEOUT_MS = 15_000;

/** What the user sees when the importer accepted the request but never replied. */
export const NO_RESPONSE = 'The importer did not respond in time.';

/**
 * Sends a request and reads its reply, failing once the deadline passes.
 *
 * The deadline covers reading the body too. A reply whose headers arrive and
 * whose body then stalls is as stuck as one that never started, and the refresh
 * call runs under the refresh lock, where a stall would hold up every renewal
 * in the process until it died.
 * @param url - The request URL.
 * @param init - The request options; any caller signal is replaced.
 * @param read - Turns the response into the caller's result, inside the deadline.
 * @returns Whatever `read` returns, when it finishes in time.
 * @throws Error with {@link NO_RESPONSE} on timeout, the wording for an
 *   importer that could not be reached, or whatever `read` throws.
 */
export async function timedFetch<T>(
  url: string,
  init: RequestInit,
  read: (res: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(NO_RESPONSE));
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([send(url, init, controller.signal).then(read), deadline]);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Starts the request, naming a failure to connect in the user's terms.
 * @param url - The request URL.
 * @param init - The request options.
 * @param signal - Aborts the request once the deadline passes.
 * @returns The response, once its headers arrive.
 * @throws Error with {@link NO_RESPONSE} after an abort, or the wording for an
 *   importer that could not be reached.
 */
async function send(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal });
  } catch {
    // A dropped connection surfaces as whatever the platform calls it, and
    // "Network request failed" names the failure without offering a way out.
    throw new Error(signal.aborted ? NO_RESPONSE : failureMessage('unreachable').text);
  }
}
