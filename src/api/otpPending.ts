/** Reads the importer's pending OTP requests. */
import { messageForStatus } from '../lib/errorMessages';
import { PENDING_OTP_BODY } from './generated';
import { authedRequest, type Session } from './importerClient';
import type { PendingOtpRequest } from './otp';
import { parsedBody } from './parseResponse';
import { readWithinDeadline } from './responseBody';

/**
 * Parses a pending-OTP response.
 * @param res - The importer's response.
 * @returns The requests it lists.
 * @throws Error when the importer refused or sent something unreadable.
 */
export async function pendingFrom(res: Response): Promise<PendingOtpRequest[]> {
  if (!res.ok) {
    throw new Error(messageForStatus(res.status));
  }
  const pendingBody = await readWithinDeadline(res, () => parsedBody(res, PENDING_OTP_BODY));
  return pendingBody.requests;
}

/**
 * Loads the pending OTP requests via `GET /api/otp/pending`.
 * @param session - The active session.
 * @returns The pending requests (may be empty); never carries codes.
 * @throws Error when the request fails.
 */
export async function getPendingOtp(session: Session): Promise<PendingOtpRequest[]> {
  return pendingFrom(await authedRequest(session, '/api/otp/pending'));
}
