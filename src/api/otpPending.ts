/** Reads the importer's pending OTP requests. */
import { messageForStatus } from '../lib/errorMessages';
import { PENDING_OTP_BODY } from './generated';
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
