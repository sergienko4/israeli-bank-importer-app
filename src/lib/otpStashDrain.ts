/**
 * Answers a request from a message that was already waiting.
 *
 * The auto-read window only opens once the importer raises a request, so a
 * bank text that arrives first has nowhere to go. The native side holds those
 * messages; this is the decision loop that spends one of them, and it runs with
 * no UI attached and possibly with the app killed.
 *
 * That makes the acknowledgement the security control rather than bookkeeping.
 * A submitted message is consumed, so the same code cannot be sent again. A
 * rejected one is recorded against the request that rejected it, because
 * retrying a wrong code is how the bank's handful of attempts get spent in a
 * loop. A transient failure records nothing at all, leaving the message usable
 * once the network comes back.
 *
 * Message bodies are read here and never persisted or logged by this module.
 */
import type { BackgroundSubmitPorts } from './otpBackgroundSubmit';
import { pickExpectation } from './otpExpectedWindow';
import { liveStashEntries, selectStashedCode, type StashedMessage } from './otpStash';

/**
 * Everything the drain needs from the outside world.
 *
 * Extends the background submit ports with the three stash operations, so both
 * paths agree on how a session is loaded and a code is sent.
 */
export interface StashDrainPorts extends BackgroundSubmitPorts {
  /** Every message currently held, expired ones included. */
  readonly list: () => Promise<StashedMessage[]>;
  /** Drops a message for good, once its code has been accepted. */
  readonly consume: (id: string) => Promise<void>;
  /** Records that a message was already sent against one request. */
  readonly markAttempt: (id: string, requestId: string) => Promise<void>;
}

/**
 * Why the drain stopped.
 *
 * `empty` means nothing is being held. `ambiguous` covers every other reason a
 * held message was not chosen: none carries a code, one was already sent
 * against this request, or several carry different codes. They are all the same
 * answer to the user — type it yourself — and none of them is worth retrying.
 */
export type StashDrainOutcome =
  'empty' | 'ambiguous' | 'no-session' | 'no-pending' | 'submitted' | 'rejected' | 'failed';

/**
 * Spends at most one held message against the importer's pending request.
 *
 * @param ports - The injected outside world.
 * @returns The reason it stopped, or `submitted` when a code was accepted.
 */
export async function drainStash(ports: StashDrainPorts): Promise<StashDrainOutcome> {
  try {
    const live = liveStashEntries(await ports.list(), ports.now());
    if (live.length === 0) return 'empty';

    const session = await ports.loadSession();
    if (session === null) return 'no-session';

    const expectation = pickExpectation(await ports.getPending(session), ports.now());
    if (expectation === null) return 'no-pending';

    const found = selectStashedCode(live, expectation.requestId, ports.now());
    if (found === null) return 'ambiguous';

    const result = await ports.submit(session, expectation.requestId, found.code);
    if (result.ok) {
      await ports.consume(found.entry.id);
      return 'submitted';
    }
    if (neverJudged(result.status)) return 'failed';
    await ports.markAttempt(found.entry.id, expectation.requestId);
    return 'rejected';
  } catch {
    return 'failed';
  }
}

/**
 * Reports whether a failing status means the code was never actually judged.
 *
 * Those failures are the importer's problem, not the code's, so the message
 * stays held for the next drain. Every other status — including a missing one —
 * counts as a verdict, because retrying a code the bank already refused spends
 * one of the few attempts it allows.
 *
 * @param status - The HTTP status behind the failure, where there was one.
 * @returns True when the message should survive to be tried again.
 */
function neverJudged(status: number | undefined): boolean {
  if (status === undefined) return false;
  return status >= 500 || status === 408 || status === 429;
}
