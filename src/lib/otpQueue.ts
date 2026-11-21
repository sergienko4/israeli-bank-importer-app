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

/**
 * Computes when a dismissed request may prompt again.
 *
 * A full-minute snooze on a request that expires sooner would hide it past its
 * deadline, so the snooze is capped to leave a margin for the next poll and for
 * typing the code. A request already inside that margin is available at once.
 * @param deadline - The request's deadline in epoch ms.
 * @param now - Current time in epoch ms (defaults to Date.now()).
 * @returns The time the snooze ends, never before `now`.
 */
export function snoozeUntil(deadline: number, now: number = Date.now()): number {
  const remaining = deadline - now;
  if (remaining <= OTP_DISMISS_RESUME_MARGIN_MS) {
    return now;
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

/**
 * Returns the ids the importer still reports.
 * @param requests - The latest pending requests.
 * @returns The live request ids.
 */
function pendingIds(requests: readonly PendingOtpRequest[]): Set<string> {
  return new Set(requests.map((request) => request.id));
}

/**
 * Drops snooze entries for requests the importer no longer reports.
 *
 * Without this the map grows for the life of the connection and a request id
 * reused by the importer would stay silent because of a dismissal from an
 * earlier one.
 * @param snoozedUntil - Request ids mapped to the time their snooze ends.
 * @param requests - The pending requests from the latest poll.
 * @returns A map containing only ids that are still pending.
 */
export function pruneSnoozed(
  snoozedUntil: ReadonlyMap<string, number>,
  requests: readonly PendingOtpRequest[],
): Map<string, number> {
  const pending = pendingIds(requests);
  return new Map([...snoozedUntil].filter(([id]) => pending.has(id)));
}

/**
 * Drops auto-submit markers for requests the importer no longer reports.
 *
 * A request that has ended no longer needs its one-shot guard, and keeping it
 * would suppress the attempt for a future request that reuses the id.
 * @param used - Request ids that already armed an automatic submission.
 * @param requests - The pending requests from the latest poll.
 * @returns A set containing only ids that are still pending.
 */
export function pruneUsed(
  used: ReadonlySet<string>,
  requests: readonly PendingOtpRequest[],
): Set<string> {
  const pending = pendingIds(requests);
  return new Set([...used].filter((id) => pending.has(id)));
}
