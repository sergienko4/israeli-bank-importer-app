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
  const pending = new Set(requests.map((request) => request.id));
  return new Map([...snoozedUntil].filter(([id]) => pending.has(id)));
}
