/**
 * Messages held because they arrived before anyone asked for a code.
 *
 * A bank frequently sends the one-time code *before* the importer raises its
 * request. `SMS_RECEIVED` is a one-shot broadcast and the app holds
 * `RECEIVE_SMS` rather than `READ_SMS`, so a message dropped at that moment is
 * gone for good — there is no inbox to look back at. Holding it briefly is what
 * makes that ordering survivable.
 *
 * The stash keeps raw bodies rather than extracted digits on purpose.
 * {@link extractOtpCode}'s rule — exactly one distinct standalone run of 4-8
 * digits *in the whole message* — cannot be re-checked from digits alone, so
 * storing only a code would mean reimplementing that rule natively and keeping
 * two copies of a security-critical decision in step. The body therefore
 * survives until TypeScript can read it, and no longer: see {@link STASH_TTL_MS}.
 */
import { extractOtpCode } from './otpMessage';

/**
 * How long a held message stays eligible.
 *
 * Matches the auto-read window cap, so a message can never be acted on at a
 * moment when a freshly opened window would already have expired.
 */
export const STASH_TTL_MS = 10 * 60 * 1000;

/**
 * The marker that takes a held message out of circulation for good.
 *
 * `attempted` normally names a request a message was sent to, which stops only
 * that request choosing it again. That is the right scope for a rejection — a
 * later request asks a different question — but the wrong one for a code the
 * importer has accepted: that message is spent for everybody, and the only
 * reason it still exists is that the write meant to delete it failed.
 *
 * Marking it with a value the importer cannot issue says so durably, through
 * the same single native write, and needs nothing new stored anywhere.
 */
export const STASH_SPENT = '*spent*';

/**
 * A message held natively because no code was being waited for when it arrived.
 *
 * The native side caps how many of these exist at once and evicts the oldest,
 * because anyone who knows the phone number can send one. That bound lives
 * where the eviction happens rather than being mirrored here.
 */
export interface StashedMessage {
  /** Content-derived identity, stable across a redelivered broadcast. */
  readonly id: string;
  /** The raw text. Parsed here, never sent anywhere. */
  readonly body: string;
  /** Originating address, kept to tell messages apart. */
  readonly sender: string;
  /** When the network handed it over, epoch milliseconds. */
  readonly receivedAt: number;
  /** Requests this message has already been submitted against. */
  readonly attempted: readonly string[];
}

/** A held message and the code it turned out to contain. */
export interface StashedCode {
  /** The message the code came from, so the caller can acknowledge it. */
  readonly entry: StashedMessage;
  /** The code to submit. */
  readonly code: string;
}

/**
 * Discards held messages that have aged out.
 *
 * @param entries - Everything currently held.
 * @param now - Current time in epoch milliseconds.
 * @returns Only those still inside {@link STASH_TTL_MS}.
 */
export function liveStashEntries(
  entries: readonly StashedMessage[],
  now: number,
): StashedMessage[] {
  return entries.filter((entry) => now - entry.receivedAt < STASH_TTL_MS);
}

/**
 * Finds every held message carrying one code.
 *
 * Banks resend, so one code can sit in two messages. Acknowledging only the
 * copy that happened to be chosen leaves its twin live: after an accepted code
 * that is a message whose answer is already spent, and after a rejected one it
 * is the entry the next drain picks up to send the same wrong code again.
 *
 * @param entries - Everything currently held.
 * @param code - The code that was submitted.
 * @param now - Current time in epoch milliseconds.
 * @returns Every live message whose body carries that code.
 */
export function stashedCopiesOf(
  entries: readonly StashedMessage[],
  code: string,
  now: number,
): StashedMessage[] {
  return liveStashEntries(entries, now).filter((entry) => extractOtpCode(entry.body) === code);
}

function spent(entry: StashedMessage): boolean {
  return entry.attempted.includes(STASH_SPENT);
}

/**
 * Chooses the code that may answer one request, if it is unambiguous.
 *
 * Two rules make this safe to run without anyone watching. A message already
 * submitted against this request is skipped, so a code the importer rejected is
 * never sent twice and cannot spend the bank's few attempts in a loop. And when
 * the live messages carry more than one distinct code — an unrelated service's
 * one-time code parses exactly as cleanly as a bank's — nothing is chosen at
 * all, which costs the user a few seconds of typing and never an attempt.
 *
 * A message marked {@link STASH_SPENT} is skipped whoever is asking.
 *
 * @param entries - Everything currently held.
 * @param requestId - The request a code would be submitted against.
 * @param now - Current time in epoch milliseconds.
 * @returns The code and the message it came from, or null when none qualifies.
 */
export function selectStashedCode(
  entries: readonly StashedMessage[],
  requestId: string,
  now: number,
): StashedCode | null {
  const candidates = liveStashEntries(entries, now)
    .filter((entry) => !spent(entry) && !entry.attempted.includes(requestId))
    .map((entry) => ({ entry, code: extractOtpCode(entry.body) }))
    .filter((candidate): candidate is StashedCode => candidate.code !== null);
  if (new Set(candidates.map((candidate) => candidate.code)).size !== 1) {
    return null;
  }
  // Seeded with null rather than relying on the check above guaranteeing a
  // first element: the guarantee holds, but it is one indirection away from
  // the call and an empty reduce throws rather than returning nothing.
  return candidates.reduce<StashedCode | null>(
    (newest, candidate) =>
      newest === null || candidate.entry.receivedAt >= newest.entry.receivedAt ? candidate : newest,
    null,
  );
}
