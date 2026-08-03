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
 * Every value except `submitted` means nothing was sent. They are distinct so
 * the caller can tell "we chose not to" from "we tried and could not".
 */
export type BackgroundSubmitOutcome =
  'no-code' | 'no-session' | 'no-pending' | 'submitted' | 'rejected' | 'failed';

/**
 * Attempts to satisfy an outstanding one-time-code request from a message.
 *
 * @param body - The raw SMS text. Read, never stored.
 * @param ports - The injected outside world.
 * @returns The reason it stopped, or `submitted` when a code was accepted.
 */
export async function autoSubmitFromMessage(
  body: string,
  ports: BackgroundSubmitPorts,
): Promise<BackgroundSubmitOutcome> {
  const code = extractOtpCode(body);
  if (code === null) return 'no-code';

  try {
    const session = await ports.loadSession();
    if (session === null) return 'no-session';

    const expectation = pickExpectation(await ports.getPending(session), ports.now());
    if (expectation === null) return 'no-pending';

    const result = await ports.submit(session, expectation.requestId, code);
    return result.ok ? 'submitted' : 'rejected';
  } catch {
    return 'failed';
  }
}
