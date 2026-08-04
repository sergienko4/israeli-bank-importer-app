import type { PendingOtpRequest } from '../api/otp';

/**
 * The window during which an arriving message may answer a request right away.
 *
 * This is the containment rule for SMS auto-read. Holding `RECEIVE_SMS` means
 * Android hands the app every message — other banks, other services' codes,
 * private conversations. What keeps that from mattering is that a message is
 * only ever handed to JavaScript, and so only ever submitted, while a request
 * the user's own bank login triggered is still outstanding.
 *
 * Outside the window the receiver does not go silent entirely: with capture
 * switched on it may put a message carrying a code into the bounded native
 * stash, so a code that arrives before the importer asks for one is not lost.
 * Nothing is submitted from there until a request appears and this window
 * decides which one it answers.
 */

/**
 * The longest a window may stay open, however distant a deadline the importer
 * reports. A misconfigured or hostile deadline should not be able to leave the
 * app reading messages for hours.
 */
export const MAX_EXPECTATION_MS = 10 * 60 * 1000;

/** A pending request the app is currently willing to answer from a message. */
export interface OtpExpectation {
  /** The request a captured code would be submitted against. */
  readonly requestId: string;
  /** Epoch milliseconds after which messages are ignored again. */
  readonly expiresAt: number;
}

/**
 * Opens a window for one pending request.
 *
 * @param pending - The request awaiting a code.
 * @param now - Current time in epoch milliseconds.
 * @returns The window, expiring at the request's deadline or the cap.
 */
export function openExpectation(pending: PendingOtpRequest, now: number): OtpExpectation {
  return {
    requestId: pending.id,
    expiresAt: Math.min(pending.deadline, now + MAX_EXPECTATION_MS),
  };
}

/**
 * Whether messages may be examined right now.
 *
 * @param expectation - The current window, or `null` when none is open.
 * @param now - Current time in epoch milliseconds.
 * @returns `true` only while the window is strictly unexpired.
 */
export function isExpectationLive(expectation: OtpExpectation | null, now: number): boolean {
  return expectation !== null && now < expectation.expiresAt;
}

/**
 * Chooses which pending request to expect a code for.
 *
 * Picks the soonest deadline rather than the newest request: that is the one
 * about to be lost, and a code arriving now is most likely answering it.
 *
 * @param pending - Requests the importer reports as awaiting a code.
 * @param now - Current time in epoch milliseconds.
 * @returns A window for the most urgent live request, or `null` if none is.
 */
export function pickExpectation(
  pending: readonly PendingOtpRequest[],
  now: number,
): OtpExpectation | null {
  const live = pending.filter((request) => request.deadline > now);
  const soonest = live.reduce<PendingOtpRequest | null>(
    (best, request) => (best === null || request.deadline < best.deadline ? request : best),
    null,
  );
  return soonest === null ? null : openExpectation(soonest, now);
}
