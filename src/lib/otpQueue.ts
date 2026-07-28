/**
 * Pure selection of the OTP request to prompt for next: the first pending
 * request the user has not dismissed and that has not expired. Kept free of
 * React so the queue logic is unit-testable.
 */
import type { PendingOtpRequest } from '../api/otp';

/**
 * Picks the next OTP request to prompt for.
 * @param requests - The pending requests from the importer.
 * @param dismissed - Ids the user has dismissed this session.
 * @param now - Current time in epoch ms (defaults to Date.now()).
 * @returns The request to prompt for, or null when there is none.
 */
export function selectPendingOtp(
  requests: PendingOtpRequest[],
  dismissed: Set<string>,
  now: number = Date.now(),
): PendingOtpRequest | null {
  return requests.find((request) => !dismissed.has(request.id) && request.deadline >= now) ?? null;
}
