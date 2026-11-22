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

/** How long the gate waits for its turn and the opt-in before giving up. */
const GATE_TIMEOUT_MS = 20_000;

/** What one gate remembers between its timer, reads, and start. */
interface GateState {
  /** Whether the gate ran out of time. */
  expired: boolean;
  /** Whether the POST has already started. */
  sendStarted: boolean;
}

/**
 * Reads the opt-in, or answers false once the gate expires.
 *
 * Answering false is what lets the queue advance when the storage read never
 * settles: the turn ends without a POST instead of blocking every later write.
 * @param readExpired - Settles when the gate runs out of time.
 * @returns Whether automatic sending is still enabled.
 */
function readPreference(readExpired: Promise<void>): Promise<boolean> {
  return Promise.race([loadOtpAutoSubmit().catch(() => false), readExpired.then(() => false)]);
}

/**
 * Starts the POST inside the capture-switch turn.
 * @param state - The gate's expiry and start flags.
 * @param start - The POST to start.
 * @returns The started POST's answer.
 * @throws SubmissionCancelledError when the gate expired before the start.
 */
async function startGated(state: GateState, start: () => Promise<Response>): Promise<Response> {
  if (state.expired) {
    throw new SubmissionCancelledError();
  }
  state.sendStarted = true;
  return start();
}

/** What one gated start needs. */
interface GateContext {
  /** The gate's expiry and start flags. */
  readonly state: GateState;
  /** Settles when the gate runs out of time. */
  readonly readExpired: Promise<void>;
  /** The POST to start. */
  readonly start: () => Promise<Response>;
  /** The attempt generation captured when the code was armed. */
  readonly attempt: AutoSubmitAttempt;
  /** The generation that must still be current. */
  readonly token: number;
  /** The importer pairing that must still own the session. */
  readonly pairing: number;
}

/**
 * Waits for the queue, re-reads intent, and starts the POST in the same turn.
 * @param context - The gate state, read signal, start, and identity checks.
 * @returns The started POST's answer.
 * @throws SubmissionCancelledError when the switches or the gate refused it.
 */
async function startWhenAllowed({
  state,
  readExpired,
  start,
  attempt,
  token,
  pairing,
}: GateContext): Promise<Response> {
  const started = await startIfAllowed(
    () => readPreference(readExpired),
    () => startGated(state, start),
    () => !state.expired && attempt.isCurrent(token) && currentPairing() === pairing,
  );
  if (started === null) {
    throw new SubmissionCancelledError();
  }
  return started.result;
}

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
      const state: GateState = { expired: false, sendStarted: false };
      let releaseRead: () => void = () => undefined;
      const readExpired = new Promise<void>((settle) => {
        releaseRead = settle;
      });
      const timer = setTimeout(() => {
        state.expired = true;
        // Release the queue even when the preference read never settles.
        releaseRead();
        if (!state.sendStarted) {
          reject(new SubmissionCancelledError());
        }
      }, GATE_TIMEOUT_MS);
      void startWhenAllowed({ state, readExpired, start, attempt, token, pairing }).then(
        (response) => {
          clearTimeout(timer);
          resolve(response);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error('The automatic send failed.'));
        },
      );
    });
}
