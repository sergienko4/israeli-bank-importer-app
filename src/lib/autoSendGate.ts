/**
 * The before-send gate for one automatic OTP submission.
 *
 * The gate waits its turn in the capture-switch queue, re-reads the opt-in, and
 * starts the POST inside that turn. A timeout while waiting expires the gate so
 * a delayed read cannot start a POST after the UI reported cancellation; once
 * the POST has started, its own transport deadline owns the outcome.
 */
import type { BeforeSend } from '../api/authedTypes';
import { SubmissionCancelledError } from '../api/authedTypes';
import { currentPairing } from '../auth/pairingGeneration';
import type { AutoSubmitAttempt } from './autoSubmitAttempt';
import { loadOtpAutoSubmit } from './otpAutoSubmitStore';
import { startIfAllowed } from './otpCaptureSwitch';

/**
 * Builds the before-send gate used after every automatic-send wait.
 * @param attempt - The attempt generation captured when the code was armed.
 * @param token - The generation that must still be current.
 * @param pairing - The importer pairing that must still own the session.
 * @returns A gate that re-reads intent and checks the generation and pairing.
 */
export function autoSendGate(
  attempt: AutoSubmitAttempt,
  token: number,
  pairing: number,
): BeforeSend {
  return (start) =>
    new Promise<Response>((resolve, reject) => {
      const state = { expired: false, sendStarted: false };
      const timer = setTimeout(() => {
        state.expired = true;
        if (!state.sendStarted) {
          reject(new SubmissionCancelledError());
        }
      }, 20_000);
      const gatedStart = async (): Promise<Response> => {
        if (state.expired) {
          throw new SubmissionCancelledError();
        }
        state.sendStarted = true;
        return start();
      };
      void startIfAllowed(
        () => loadOtpAutoSubmit().catch(() => false),
        gatedStart,
        () => !state.expired && attempt.isCurrent(token) && currentPairing() === pairing,
      )
        .then((started) => {
          clearTimeout(timer);
          if (started === null) {
            reject(new SubmissionCancelledError());
            return;
          }
          started.result.then(resolve, reject);
        })
        .catch((error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error('The automatic send failed.'));
        });
    });
}
