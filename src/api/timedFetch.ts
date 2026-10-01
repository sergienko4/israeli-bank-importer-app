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

/**
 * How long a refresh is left to finish after its caller stopped waiting.
 *
 * The portal retires a refresh token the moment it accepts it, so a reply that
 * misses {@link REQUEST_TIMEOUT_MS} still carries the only live token. Waiting
 * on it keeps a slow importer from turning into a replay; the limit is there
 * because a request that truly lost its reply would otherwise hold the refresh
 * lock, and every renewal behind it, for the life of the process.
 */
export const SETTLE_LIMIT_MS = 60_000;

/** What the user sees when the importer accepted the request but never replied. */
export const NO_RESPONSE = 'The importer did not respond in time.';

/**
 * Sends a request and reads its reply, failing once the deadline passes.
 *
 * The deadline covers reading the body too. A reply whose headers arrive and
 * whose body then stalls is as stuck as one that never started.
 * @param url - The request URL.
 * @param init - The request options; any caller signal is replaced.
 * @param read - Turns the response into the caller's result, inside the deadline.
 * @returns Whatever `read` returns, when it finishes in time.
 * @throws Error with {@link NO_RESPONSE} on timeout, the wording for an
 *   importer that could not be reached, or whatever `read` throws.
 */
export function timedFetch<T>(
  url: string,
  init: RequestInit,
  read: (res: Response) => Promise<T>,
): Promise<T> {
  return fetchWithin({ url, init, read }, REQUEST_TIMEOUT_MS);
}

/**
 * Sends a request whose reply must not be thrown away on the usual deadline.
 *
 * For a call that changes state on the importer before it answers, where an
 * abandoned reply loses something only that reply carried. The caller still
 * answers its user on time by racing this through {@link answerInTime}, and
 * keeps whatever arrives later; this only stops waiting at
 * {@link SETTLE_LIMIT_MS}.
 * @param url - The request URL.
 * @param init - The request options; any caller signal is replaced.
 * @param read - Turns the response into the caller's result, inside the limit.
 * @returns Whatever `read` returns, when it finishes within the limit.
 * @throws Error with {@link NO_RESPONSE} past the limit, the wording for an
 *   importer that could not be reached, or whatever `read` throws.
 */
export function patientFetch<T>(
  url: string,
  init: RequestInit,
  read: (res: Response) => Promise<T>,
): Promise<T> {
  return fetchWithin({ url, init, read }, SETTLE_LIMIT_MS);
}

/**
 * Waits for work on the usual deadline without cancelling it.
 *
 * The work carries on after the deadline, so whoever started it can still keep
 * what it produces.
 * @param work - Work already started, usually a {@link patientFetch}.
 * @returns What the work produced, when it finished in time.
 * @throws Error with {@link NO_RESPONSE} once the deadline passes, or whatever
 *   the work throws before then.
 */
export function answerInTime<T>(work: Promise<T>): Promise<T> {
  return within(work, REQUEST_TIMEOUT_MS);
}

/** One request: where it goes, what it sends, and how its reply is read. */
interface Request<T> {
  readonly url: string;
  readonly init: RequestInit;
  readonly read: (res: Response) => Promise<T>;
}

/**
 * Sends a request and reads its reply, aborting it once `ms` passes.
 * @param request - The request to send.
 * @param ms - How long the request may take, reading included.
 * @returns Whatever the request's reader returns.
 */
function fetchWithin<T>(request: Request<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const reply = send(request.url, request.init, controller.signal).then(request.read);
  return within(reply, ms, () => {
    controller.abort();
  });
}

/**
 * Settles with `work`, or fails with {@link NO_RESPONSE} once `ms` passes.
 * @param work - Work already started.
 * @param ms - How long to wait for it.
 * @param expire - Runs once the deadline passes, after the failure is raised.
 * @returns What the work produced, when it finished in time.
 */
async function within<T>(work: Promise<T>, ms: number, expire?: () => void): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(NO_RESPONSE));
      expire?.();
    }, ms);
  });
  try {
    return await Promise.race([work, deadline]);
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
