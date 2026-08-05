/**
 * Submits a bank one-time code found in an SMS without any UI attached.
 *
 * This is the zero-touch path: it may run while the app is backgrounded or
 * killed, so it has no screen to report to and no user to correct it. That
 * makes every stopping condition a security control rather than an
 * optimisation, and each one is pinned by a test beside this file.
 *
 * Two properties are deliberate:
 *
 * - Extraction happens before any I/O. A message that carries no unambiguous
 *   code is dropped locally, so an ordinary text never reaches the network and
 *   never leaves the device.
 * - The importer's own pending list is the authority on whether a code is
 *   wanted. A message arriving when nothing is pending is discarded, which is
 *   what stops a spoofed or replayed text from being acted on.
 *
 * The message body is never persisted or logged: it exists as an argument and
 * is discarded when this returns.
 */
import type { Session } from '../api/importerClient';
import type { SaveResult } from '../api/manifest';
import type { PendingOtpRequest } from '../api/otp';
import { pickExpectation } from './otpExpectedWindow';
import { extractOtpCode } from './otpMessage';

/**
 * Everything the background path needs from the outside world.
 *
 * These are injected rather than imported so the decision logic can be tested
 * without a device, a network, or a running app.
 */
export interface BackgroundSubmitPorts {
  /** The stored connection, or null when the device is not paired. */
  readonly loadSession: () => Promise<Session | null>;
  /** The importer's current outstanding one-time-code requests. */
  readonly getPending: (session: Session) => Promise<PendingOtpRequest[]>;
  /** Sends a code against one request. */
  readonly submit: (session: Session, id: string, code: string) => Promise<SaveResult>;
  /** The current time, injected so expiry is testable. */
  readonly now: () => number;
}

/**
 * Why the background path stopped.
 *
 * Every value except `submitted` means nothing was accepted. They are distinct
 * so the caller can tell "we chose not to" from "we tried and could not", and —
 * because this path has no screen and may be retried — "we do not know".
 */
export type BackgroundSubmitOutcome =
  'no-code' | 'no-session' | 'no-pending' | 'submitted' | 'rejected' | 'failed' | 'unknown';

/** The request a code should answer, once one has been found. */
interface Target {
  /** The session the code will be sent over. */
  readonly session: Session;
  /** The importer's id for the request awaiting a code. */
  readonly requestId: string;
}

/**
 * Attempts to satisfy an outstanding one-time-code request from a message.
 *
 * @param body - The raw SMS text. Read and turned into digits here, never
 * stored by this path.
 * @param ports - The injected outside world.
 * @returns The reason it stopped, or `submitted` when a code was accepted.
 */
export async function autoSubmitFromMessage(
  body: string,
  ports: BackgroundSubmitPorts,
): Promise<BackgroundSubmitOutcome> {
  const code = extractOtpCode(body);
  if (code === null) return 'no-code';

  const target = await intendedRequest(ports);
  return typeof target === 'string' ? target : send(ports, target, code);
}

/**
 * Finds the request a captured code should answer, if there is one.
 *
 * Kept apart from the send so their failures can be told apart. Everything here
 * is a read: nothing has been given to the importer yet, so a failure leaves the
 * code unspent and asking again is free.
 *
 * @param ports - The injected outside world.
 * @returns The request to answer, or why there is nothing to answer.
 */
async function intendedRequest(
  ports: BackgroundSubmitPorts,
): Promise<Target | 'no-session' | 'no-pending' | 'failed'> {
  try {
    const session = await ports.loadSession();
    if (session === null) return 'no-session';

    const expectation = pickExpectation(await ports.getPending(session), ports.now());
    if (expectation === null) return 'no-pending';

    return { session, requestId: expectation.requestId };
  } catch {
    return 'failed';
  }
}

/**
 * Reports whether a failing status means the code was never actually judged.
 *
 * Those failures are the importer's problem, not the code's, so the code stays
 * spendable and the caller may offer it again. Every other status — including a
 * missing one — counts as a verdict, because retrying a code the bank already
 * refused spends one of the few attempts it allows.
 *
 * Lives here rather than beside either caller because both submission paths
 * have to read a refusal the same way. One treating a 503 as a verdict while
 * the other treats it as a hiccup would make a code's fate depend on which
 * wake-up happened to pick it up.
 *
 * @param status - The HTTP status behind the failure, where there was one.
 * @returns True when the code should survive to be tried again.
 */
export function neverJudged(status: number | undefined): boolean {
  if (status === undefined) return false;
  return status >= 500 || status === 408 || status === 429;
}

/**
 * Gives the code to the importer, and reports what became of it.
 *
 * A throw here is *not* reported as a failure. The request was already on its
 * way when the connection went — the phone leaving the network mid-send is the
 * ordinary case for a pocket capture — so the importer may well have taken the
 * code and forwarded it to the bank, with only the answer lost. Calling that a
 * failure would invite a caller to send the same code again, and a bank grants
 * only a handful of attempts before it locks the request out.
 *
 * A refusal the importer never made is separated out for the opposite reason. A
 * 503 says the code was not looked at, so reporting it as a refusal would strand
 * an unspent code over an outage that clears in seconds.
 *
 * @param ports - The injected outside world.
 * @param target - The session and request the code answers.
 * @param code - The digits taken from the message.
 * @returns Whether the code was accepted, refused, unjudged, or left in doubt.
 */
async function send(
  ports: BackgroundSubmitPorts,
  target: Target,
  code: string,
): Promise<BackgroundSubmitOutcome> {
  try {
    const result = await ports.submit(target.session, target.requestId, code);
    if (result.ok) return 'submitted';
    return neverJudged(result.status) ? 'failed' : 'rejected';
  } catch {
    return 'unknown';
  }
}
