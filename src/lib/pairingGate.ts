/**
 * Refuses an OTP send whose importer pairing changed after it was loaded.
 *
 * A screen or background task holds the session it read. A Disconnect or a new
 * sign-in can replace that pairing while the send waits behind an earlier code,
 * a token renewal, or a 401 retry. Without a check at the moment the request
 * starts, the code would still leave for an importer the user has just moved
 * away from.
 */
import { type BeforeSend, SubmissionCancelledError } from '../api/authedTypes';
import { currentPairing } from '../auth/pairingGeneration';

/**
 * Builds a gate that permits the send only while its pairing is still current.
 * @param pairing - The pairing in force when the session was loaded.
 * @returns A gate for the transport's before-send hook.
 */
export function pairingGate(pairing: number): BeforeSend {
  return (start) =>
    currentPairing() === pairing ? start() : Promise.reject(new SubmissionCancelledError());
}
