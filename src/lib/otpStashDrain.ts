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
 * offer. A code whose fate is unknown is treated the same way, because the
 * importer may have taken it. A rejected code is recorded against the request
 * that rejected it, on every copy for the same reason, because retrying a wrong
 * code is how the bank's handful of attempts get spent in a loop. Only a
 * transient failure records nothing at all, leaving the message usable once the
 * network comes back.
 *
 * Because it is the security control, one acknowledgement that fails may not
 * abandon the copies behind it, and each falls back to the other. What that
 * buys differs by outcome, because the scopes differ: an accepted code is
 * marked spent and leaves circulation entirely, while a rejected one leaves
 * circulation only for the request that rejected it — a later request asks a
 * different question, and a "your request is gone" refusal must not burn a code
 * the bank itself never saw.
 *
 * Message bodies are read here and never persisted or logged by this module.
 */
import type { SaveResult } from '../api/manifest';
import { type BackgroundSubmitPorts, neverJudged, type PairedSession } from './otpBackgroundSubmit';
import { SendRefusedError } from './otpCaptureSwitch';
import { ACK_MARGIN_MS, MIN_SEND_MS, settleWithin, SUBMIT_DEADLINE_MS } from './otpDeadline';
import { pickExpectation } from './otpExpectedWindow';
import {
  liveStashEntries,
  selectStashedCode,
  STASH_SPENT,
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
  /**
   * Whether this run is still the one the caller is waiting on.
   *
   * A run whose own step outlasted the lock that serialises drains has been
   * superseded, and is working from a list of held messages read before the run
   * that replaced it existed. Sending from that list would offer a code the
   * newer run may already have sent.
   */
  readonly stillOwned: () => boolean;
  /** How long is left before the lock behind this run is released. */
  readonly remainingMs: () => number;
}

/**
 * Why the drain stopped.
 *
 * `empty` means nothing is being held. `ambiguous` covers every other reason a
 * held message was not chosen: none carries a code, one was already sent
 * against this request, every copy is already spent, or several carry different
 * codes. They are all the same answer to the user — type it yourself — and none
 * of them is worth retrying. `unknown` means a code went out and no answer came
 * back, which is also not worth retrying, for the opposite reason. `superseded`
 * means the run ran out of its claim on the drain before its send started —
 * either a newer run has already taken over, too little is left to record
 * what a send did, or the send was still waiting its turn when the run stopped
 * waiting for it — so the code never left the device, and whatever is worth
 * doing is the next run's to do.
 * `not-allowed` means the send was refused as it would have started — the
 * switches had been turned off, or the user had signed in elsewhere or
 * disconnected since the session was loaded — so the code never left the
 * device and nothing is recorded against it.
 */
export type StashDrainOutcome =
  | 'empty'
  | 'ambiguous'
  | 'no-session'
  | 'no-pending'
  | 'submitted'
  | 'rejected'
  | 'failed'
  | 'unknown'
  | 'superseded'
  | 'not-allowed';

/**
 * Spends at most one held message against the importer's pending request.
 *
 * @param ports - The injected outside world.
 * @returns The reason it stopped, or `submitted` when a code was accepted.
 */
export async function drainStash(ports: StashDrainPorts): Promise<StashDrainOutcome> {
  try {
    if (liveStashEntries(await ports.list(), ports.now()).length === 0) return 'empty';

    const session = await ports.loadSession();
    if (session === null) return 'no-session';

    // Read again, because loading the session can wait behind a sign-in that
    // forgot every code held for the pairing it replaced. A code from the first
    // read would go to the new pairing's importer.
    const live = liveStashEntries(await ports.list(), ports.now());
    if (live.length === 0) return 'empty';

    const expectation = pickExpectation(await ports.getPending(session), ports.now());
    if (expectation === null) return 'no-pending';

    const found = selectStashedCode(live, expectation.requestId, ports.now());
    if (found === null) return 'ambiguous';

    return await spendChoice(ports, {
      session,
      requestId: expectation.requestId,
      code: found.code,
      copies: stashedCopiesOf(live, found.code, ports.now()),
    });
  } catch {
    return 'failed';
  }
}

/** A held code chosen to answer a request, with every live copy of it. */
interface Choice {
  /** The session the code will be sent over. */
  readonly session: PairedSession;
  /** The importer's id for the request the code answers. */
  readonly requestId: string;
  /** The code to send. */
  readonly code: string;
  /** Every live held message carrying that code, settled together. */
  readonly copies: readonly StashedMessage[];
}

/**
 * Sends the chosen code and records what became of every copy of it.
 *
 * @param ports - The injected outside world.
 * @param choice - The code, the request it answers, and its copies.
 * @returns What became of the code.
 */
async function spendChoice(ports: StashDrainPorts, choice: Choice): Promise<StashDrainOutcome> {
  const { session, requestId, code, copies } = choice;
  const drop = (id: string): Promise<void> => ports.consume(id);
  const record = (id: string): Promise<void> => ports.markAttempt(id, requestId);
  const spend = (id: string): Promise<void> => ports.markAttempt(id, STASH_SPENT);
  const allowance = sendWindow(ports);
  if (allowance === null) return 'superseded';
  const result = await sent(
    (claim) => ports.submit({ session, requestId, code, claim }),
    ports,
    allowance,
  );
  if (result === 'abandoned') return 'superseded';
  if (result === 'not-allowed') return 'not-allowed';
  if (result === 'unknown') {
    // Marked spent rather than merely attempted, because the scope of the
    // doubt is the code itself and not this request. Recording it against
    // this request alone would leave it selectable by the next one, where a
    // code the bank may already have seen would spend a second attempt — and
    // would sit alongside the fresh message answering that request, whose
    // different code makes the pair ambiguous and stops either being sent.
    await acknowledgeEach(copies, orElse(drop, spend));
    return 'unknown';
  }
  if (result.ok) {
    // If both of these writes fail the entry stays spendable and a later drain
    // can resubmit. Nothing here can close that: both go through the same
    // native module, so a context that refuses one refuses any record we could
    // keep instead. It has to be closed by the importer making a submit for a
    // request id idempotent. Until then the entry expires within the TTL.
    await acknowledgeEach(copies, orElse(drop, spend));
    return 'submitted';
  }
  if (neverJudged(result.status)) return 'failed';
  await acknowledgeEach(copies, orElse(record, drop));
  return 'rejected';
}

/**
 * How long this run may spend on the send, or null when it must not make one.
 *
 * A send is only safe while there is room left to record what it did. The reads
 * before it have no deadline of their own, so how much of the run they consumed
 * is unknowable in advance and a fixed constant would compose with them into
 * something longer than the run's claim on the lock — leaving the lock to
 * release with the message still on offer and the next drain sending the same
 * code. Taking the deadline from what is left instead makes that bound hold
 * whatever the reads cost, and refuses the send outright once too little is
 * left to be worth starting one.
 *
 * @param ports - The injected outside world, carrying this run's lease.
 * @returns Milliseconds the send may take, or null when there is no room.
 */
function sendWindow(ports: StashDrainPorts): number | null {
  if (!ports.stillOwned()) return null;
  const room = ports.remainingMs() - ACK_MARGIN_MS;
  return room >= MIN_SEND_MS ? Math.min(SUBMIT_DEADLINE_MS, room) : null;
}

/**
 * Gives the code to the importer, keeping a lost answer apart from a failure.
 *
 * The send is wrapped on its own because it is the only step that can leave
 * something behind. Everything before it is a read, so a failure there means the
 * importer was never given the code and the message is still worth trying; a
 * failure here means the request was already on its way when the connection
 * went, which is the ordinary case for a capture made in someone's pocket. The
 * importer may well have taken the code and forwarded it to the bank with only
 * the answer lost, so the caller must treat it as spent rather than send again.
 *
 * Silence is treated the same as a failure, and on a deadline, because nothing
 * underneath enforces one: an importer that accepts the connection and then says
 * nothing would otherwise leave the caller with no answer to act on at the
 * moment it most needs one.
 *
 * A send refused as it would have started is kept apart as well: it is the one
 * failure that proves the code never left the device.
 *
 * So is a send that had not started when the wait ran out. A send waits its turn
 * behind any change to the switches before it starts, and that wait counts
 * against the same deadline. Reporting a send that never started as `unknown`
 * would spend a code the importer never saw, and the send would then go out
 * late, after this run could record anything. So the send claims its start from
 * here, and once the wait is over the claim is refused, along with the send.
 *
 * @param submit - The send, already bound to its session, request and code,
 *   given the claim it must make as it starts.
 * @param ports - The injected outside world, carrying this run's lease.
 * @param ms - How long to wait, already trimmed to what the run has left.
 * @returns What the importer said, `unknown` when it never said anything,
 *   `not-allowed` when the send was refused before it started, or `abandoned`
 *   when it was still waiting to start, or had too little time left to start.
 */
async function sent(
  submit: (claim: () => boolean) => Promise<SaveResult>,
  ports: StashDrainPorts,
  ms: number,
): Promise<SaveResult | 'unknown' | 'not-allowed' | 'abandoned'> {
  const start = startClaim(ports, ms);
  let answer: SaveResult | 'unknown' | 'not-allowed' | undefined;
  const asking = (async () => {
    try {
      answer = await submit(start.claim);
    } catch (error) {
      answer = error instanceof SendRefusedError ? 'not-allowed' : 'unknown';
    }
  })();
  await settleWithin(asking, ms);
  return start.stop(answer !== undefined) ? 'abandoned' : (answer ?? 'unknown');
}

/** The drain's half of a send's claim on its own start. */
interface StartClaim {
  /** Asked once by the send as it would start. True means it has started. */
  readonly claim: () => boolean;
  /**
   * Stops waiting for the send. A send that neither settled nor started by now
   * is abandoned, and a claim it makes later is refused.
   *
   * @param settled - Whether the send had settled by the time the wait ended.
   * @returns True when the send was abandoned, or was refused its start.
   */
  readonly stop: (settled: boolean) => boolean;
}

/**
 * Lets a send start only while this run is still waiting for it.
 *
 * Whichever comes first — the send claiming its start, or the run stopping its
 * wait — settles the matter, because both happen on the one JavaScript thread.
 * A claim also needs this run to still hold its lease, with at least the
 * minimum send time left of its allowance, for the reason {@link sendWindow}
 * refuses a send with less: one squeezed into a sliver is near-certain to be
 * cut off unanswered, spending the code for nothing.
 *
 * @param ports - The injected outside world, carrying this run's lease.
 * @param ms - How long the run waits for the send.
 * @returns The claim to give the send, and the way to stop waiting.
 */
function startClaim(ports: StashDrainPorts, ms: number): StartClaim {
  const endsWithRemaining = ports.remainingMs() - ms;
  let state: 'waiting' | 'started' | 'abandoned' = 'waiting';
  return {
    claim: () => {
      if (state !== 'waiting') return false;
      const room = ports.remainingMs() - endsWithRemaining;
      state = ports.stillOwned() && room >= MIN_SEND_MS ? 'started' : 'abandoned';
      return state === 'started';
    },
    stop: (settled) => {
      if (!settled && state === 'waiting') state = 'abandoned';
      return state === 'abandoned';
    },
  };
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
