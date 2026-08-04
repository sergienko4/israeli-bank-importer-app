/**
 * Answers a request from a message that was already waiting.
 *
 * The auto-read window only opens once the importer raises a request, so a
 * bank text that arrives first has nowhere to go. The native side holds those
 * messages; this is the decision loop that spends one of them, and it runs with
 * no UI attached and possibly with the app killed.
 *
 * That makes the acknowledgement the security control rather than bookkeeping.
 * A submitted code is consumed from every message carrying it, so it cannot be
 * sent again — banks resend, and a leftover copy is a spent answer still on
 * offer. A rejected code is recorded against the request that rejected it, on
 * every copy for the same reason, because retrying a wrong code is how the
 * bank's handful of attempts get spent in a loop. A transient failure records
 * nothing at all, leaving the message usable once the network comes back.
 *
 * Because it is the security control, one acknowledgement that fails may not
 * abandon the copies behind it, and each falls back to the other: a message
 * that cannot be dropped is recorded instead, and one that cannot be recorded
 * is dropped. Either outcome takes the code out of circulation, which is the
 * whole point of the step.
 *
 * Message bodies are read here and never persisted or logged by this module.
 */
import type { BackgroundSubmitPorts } from './otpBackgroundSubmit';
import { pickExpectation } from './otpExpectedWindow';
import {
  liveStashEntries,
  selectStashedCode,
  stashedCopiesOf,
  type StashedMessage,
} from './otpStash';

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

    const copies = stashedCopiesOf(live, found.code, ports.now());
    const drop = (id: string): Promise<void> => ports.consume(id);
    const record = (id: string): Promise<void> => ports.markAttempt(id, expectation.requestId);
    const result = await ports.submit(session, expectation.requestId, found.code);
    if (result.ok) {
      await acknowledgeEach(copies, orElse(drop, record));
      return 'submitted';
    }
    if (neverJudged(result.status)) return 'failed';
    await acknowledgeEach(copies, orElse(record, drop));
    return 'rejected';
  } catch {
    return 'failed';
  }
}

/**
 * Pairs an acknowledgement with the one to fall back on when it fails.
 *
 * The two are interchangeable for this purpose: dropping a message and marking
 * it both stop a later drain choosing it, and after the importer has judged the
 * code, keeping the message has no value left to protect.
 *
 * @param primary - What this acknowledgement is meant to do.
 * @param fallback - What to do instead when that fails.
 * @returns An acknowledgement for one held message.
 */
function orElse(
  primary: (id: string) => Promise<void>,
  fallback: (id: string) => Promise<void>,
): (id: string) => Promise<void> {
  return async (id) => {
    try {
      await primary(id);
    } catch {
      await fallback(id);
    }
  };
}

/**
 * Acknowledges held messages one after another.
 *
 * Sequential on purpose: every native acknowledgement rewrites the whole stored
 * list, so two of them in flight at once can lose one of the two edits — which
 * is the entry left behind that this exists to remove.
 *
 * @param copies - The messages to acknowledge.
 * @param acknowledge - What to do with each one's id.
 */
async function acknowledgeEach(
  copies: readonly StashedMessage[],
  acknowledge: (id: string) => Promise<void>,
): Promise<void> {
  await copies.reduce(
    (previous, copy) => previous.then(() => attempted(acknowledge(copy.id))),
    Promise.resolve(),
  );
}

/**
 * Waits for one acknowledgement, treating a failure as done with.
 *
 * A copy that cannot be acknowledged even by the fallback must not strand the
 * copies behind it, and must not turn an accepted code into a reported failure:
 * the importer has that code either way, and saying otherwise is how it comes
 * to be sent twice. What is left behind expires with the rest of the stash.
 *
 * @param promise - The acknowledgement in flight.
 */
async function attempted(promise: Promise<void>): Promise<void> {
  try {
    await promise;
  } catch {
    // Deliberately nothing: both ways of taking the message out of circulation
    // have already been tried.
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
