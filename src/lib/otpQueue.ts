/**
 * Pure selection of the OTP request to prompt for next: the first pending
 * request whose snooze has elapsed and whose deadline has not. Kept free of
 * React so the queue logic is unit-testable.
 */
import type { PendingOtpRequest } from '../api/otp';

/**
 * How long a dismissed prompt stays quiet.
 *
 * A dismissal has to be recoverable: the importer keeps the request open until
 * its deadline, so suppressing it for the whole session would turn one
 * accidental backdrop tap into a failed bank login. A minute is long enough to
 * finish whatever interrupted the user and short enough to fit inside a normal
 * OTP window.
 */
export const OTP_DISMISS_SNOOZE_MS = 60_000;

/** Keeps enough of the request alive to poll and type the code after a snooze. */
export const OTP_DISMISS_RESUME_MARGIN_MS = 10_000;

/** A short quiet window after an answer, and for a dismissal near the deadline. */
export const OTP_ANSWERED_QUIET_MS = 5_000;

/**
 * Computes when a dismissed request may prompt again.
 *
 * A full-minute snooze on a request that expires sooner would hide it past its
 * deadline, so the snooze is capped to leave a margin for the next poll and for
 * typing the code. Inside that margin it stays quiet only until the deadline.
 * @param deadline - The request's deadline in epoch ms.
 * @param now - Current time in epoch ms (defaults to Date.now()).
 * @returns The time the snooze ends, never before `now`.
 */
export function snoozeUntil(deadline: number, now: number = Date.now()): number {
  const remaining = deadline - now;
  if (remaining <= OTP_DISMISS_RESUME_MARGIN_MS) {
    // Too close to the deadline for a full snooze, but still quiet for the
    // rest of the request instead of reappearing on the very next poll.
    return Math.max(now, Math.min(deadline, now + OTP_ANSWERED_QUIET_MS));
  }
  return now + Math.min(OTP_DISMISS_SNOOZE_MS, remaining - OTP_DISMISS_RESUME_MARGIN_MS);
}

/**
 * Picks the next OTP request to prompt for.
 * @param requests - The pending requests from the importer.
 * @param snoozedUntil - Request ids mapped to the time their snooze ends.
 * @param now - Current time in epoch ms (defaults to Date.now()).
 * @returns The request to prompt for, or null when there is none.
 */
export function selectPendingOtp(
  requests: PendingOtpRequest[],
  snoozedUntil: ReadonlyMap<string, number>,
  now: number = Date.now(),
): PendingOtpRequest | null {
  return (
    requests.find(
      (request) => request.deadline >= now && (snoozedUntil.get(request.id) ?? 0) <= now,
    ) ?? null
  );
}

/** What the gap check needs from one poll. */
export interface GapCheck {
  /** The request currently shown, or null. */
  readonly current: PendingOtpRequest | null;
  /** The latest pending requests. */
  readonly requests: readonly PendingOtpRequest[];
  /** The request the latest snapshot selected, or null. */
  readonly next: PendingOtpRequest | null;
  /** How many consecutive snapshots have omitted `current`. */
  readonly misses: number;
  /** Current time in epoch ms (defaults to Date.now()). */
  readonly now?: number;
}

/**
 * Reports whether the visible request should survive one missing snapshot.
 *
 * A single empty or incomplete poll is not proof that the importer ended the
 * request; dropping the sheet there loses the user's keyboard mid-code.
 * @param check - The current, latest, selected, and miss-count values.
 * @returns True when `current` should stay visible for this snapshot.
 */
export function keepThroughGap({
  current,
  requests,
  next,
  misses,
  now = Date.now(),
}: GapCheck): boolean {
  if (current === null || next !== null || misses >= 1 || current.deadline <= now) {
    return false;
  }
  return !requests.some((request) => request.id === current.id);
}

/**
 * Drops snooze entries once their quiet period has elapsed.
 *
 * Presence in the latest poll is deliberately not required: the importer can
 * answer with one transient empty snapshot while a request is still live, and
 * treating that as proof of completion would re-prompt a request the user just
 * dismissed. The entry is dead on its own clock instead.
 * @param snoozedUntil - Request ids mapped to the time their snooze ends.
 * @param now - Current time in epoch ms (defaults to Date.now()).
 * @returns A map containing only entries that are still quiet.
 */
export function pruneSnoozed(
  snoozedUntil: ReadonlyMap<string, number>,
  now: number = Date.now(),
): Map<string, number> {
  return new Map([...snoozedUntil].filter(([, until]) => until > now));
}

/**
 * Drops auto-submit markers whose request deadline has passed.
 *
 * Kept by deadline rather than by the latest poll so one transient empty
 * snapshot cannot re-arm a request that already spent its automatic attempt.
 * @param used - Request ids mapped to their deadlines.
 * @param now - Current time in epoch ms (defaults to Date.now()).
 * @returns A map containing only live markers.
 */
export function pruneUsed(
  used: ReadonlyMap<string, number>,
  now: number = Date.now(),
): Map<string, number> {
  return new Map([...used].filter(([, deadline]) => deadline >= now));
}
