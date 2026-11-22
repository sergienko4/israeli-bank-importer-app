/**
 * The OTP prompt's single network write.
 *
 * Kept out of the screen so the prompt stays within the project's function and
 * file caps, and so the accepted-code reset is testable with the submission.
 */
import { useLayoutEffect, useRef, useState } from 'react';

import type { BeforeSend } from '../api/authedTypes';
import { type Session, submitOtp } from '../api/importerClient';
import { useAuth } from '../auth/AuthContext';
import { type OtpSendResult } from './autoSubmitAttempt';
import { reportedOrFallback } from './errorMessages';
import { haptics } from './haptics';
import { isValidOtpCode, normalizeOtpCodeInput } from './otpCode';
import { pairingGate } from './pairingGate';

const CODE_REJECTED = 'The importer would not accept that code. Check it and try again.';

/** What one foreground send produced. */
type SendOutcome = { kind: 'sent' } | { kind: 'failed'; message: string } | { kind: 'cancelled' };

/** One foreground send. */
interface SendCodeRequest {
  /** The active importer session. */
  readonly session: Session;
  /** The pending request being answered. */
  readonly requestId: string;
  /** The normalised code to send. */
  readonly code: string;
  /** Orders the final opt-in read and POST start after every wait. */
  readonly beforeSend?: BeforeSend;
}

/**
 * Sends a code to the importer and flattens every outcome to one value.
 * @param request - The session, request id, code, and before-send gate.
 * @returns Whether the code left, failed with a message, or was cancelled.
 */
async function sendCode({
  session,
  requestId,
  code,
  beforeSend,
}: SendCodeRequest): Promise<SendOutcome> {
  try {
    const result = await submitOtp({ session, id: requestId, code, beforeSend });
    if (result === null) {
      return { kind: 'cancelled' };
    }
    return result.ok
      ? { kind: 'sent' }
      : { kind: 'failed', message: reportedOrFallback(result.error, CODE_REJECTED) };
  } catch (error: unknown) {
    const reported = error instanceof Error ? error.message : undefined;
    return { kind: 'failed', message: reportedOrFallback(reported, CODE_REJECTED) };
  }
}

/** The submit state and controls the prompt renders. */
export interface OtpSubmission {
  /** The current code text. */
  readonly code: string;
  /** Replaces the code text. */
  readonly setCode: (code: string) => void;
  /** Whether a code is on its way to the importer. */
  readonly submitting: boolean;
  /** Why the last submission failed, or null. */
  readonly error: string | null;
  /** Clears the failure as the user edits. */
  readonly setError: (error: string | null) => void;
  /** Validates and sends one code, optionally re-checking intent at send time. */
  readonly submit: (candidate: string, beforeSend?: BeforeSend) => Promise<OtpSendResult>;
}

/** The state a finished submission reports through. */
interface OutcomeContext {
  /** What the send produced. */
  readonly outcome: SendOutcome;
  /** The pending request being answered. */
  readonly requestId: string;
  /** Clears the accepted code. */
  readonly setCode: (code: string) => void;
  /** Shows or clears the failure. */
  readonly setError: (error: string | null) => void;
  /** Reports the accepted code to the parent. */
  readonly onSubmitted: (requestId: string) => void;
}

/**
 * Reports one finished send and maps it to the prompt's result.
 * @param context - The outcome, request and state setters.
 * @returns Whether the code left, failed, or was cancelled.
 */
function finishSubmission({
  outcome,
  requestId,
  setCode,
  setError,
  onSubmitted,
}: OutcomeContext): OtpSendResult {
  if (outcome.kind === 'failed') {
    haptics.warning();
    setError(outcome.message);
    return 'failed';
  }
  if (outcome.kind === 'cancelled') {
    return 'cancelled';
  }
  // The prompt can stay mounted for the next request; an accepted code must
  // not remain in the field where Submit could send it again.
  setCode('');
  haptics.success();
  onSubmitted(requestId);
  return 'sent';
}

/**
 * Validates one code and the connection before anything is sent.
 * @param candidate - What the user or the countdown supplied.
 * @param connection - The active importer session, or null when disconnected.
 * @param setError - Shows why the send cannot start.
 * @returns The session and normalised code, or null when the send must not start.
 */
function prepareCode(
  candidate: string,
  connection: Session | null,
  setError: (error: string | null) => void,
): { session: Session; code: string } | null {
  const trimmed = normalizeOtpCodeInput(candidate);
  if (!isValidOtpCode(trimmed)) {
    setError('Enter the 4–8 digit app OTP code.');
    return null;
  }
  if (!connection) {
    haptics.warning();
    setError('Reconnect to the importer, then enter the code again.');
    return null;
  }
  return { session: connection, code: trimmed };
}

/** One POST the prompt has on its way. */
interface SubmissionFlight {
  /** The request it belongs to. */
  readonly requestId: string;
  /** Names this exact send, so a newer one can supersede it. */
  readonly token: object;
}

/**
 * Reports whether this send is still the one the prompt is tracking.
 * @param flight - The prompt's flight ref.
 * @param token - The send's own token.
 * @returns Whether no request change or newer send replaced it.
 */
function isCurrentFlight(flight: { current: SubmissionFlight | null }, token: object): boolean {
  return flight.current?.token === token;
}

/**
 * Tracks the POST a prompt has on its way.
 *
 * `requestId` is a dependency rather than a filter: when the prompt moves to
 * another request, the cleanup drops the flight even if the same request id
 * comes back after an intervening one, so a send from the previous visit can
 * never be mistaken for the current visit's send.
 * @param requestId - The request the prompt currently shows.
 * @returns A ref holding the flight, or null when none is on its way.
 */
function useSubmissionFlight(requestId: string): { current: SubmissionFlight | null } {
  const flight = useRef<SubmissionFlight | null>(null);

  useLayoutEffect(
    () => () => {
      flight.current = null;
    },
    [requestId],
  );

  return flight;
}

/** What one prompt's submit closure needs from the hook. */
interface SubmitContext {
  /** The pending request being answered. */
  readonly requestId: string;
  /** The session the prompt rendered with. */
  readonly connection: Session | null;
  /** The pairing the request arrived under. */
  readonly pairing: number;
  /** The prompt's in-flight send, if any. */
  readonly flight: { current: SubmissionFlight | null };
  /** Replaces the code text. */
  readonly setCode: (code: string) => void;
  /** Shows or clears the failure. */
  readonly setError: (error: string | null) => void;
  /** Records which request shows the loading state. */
  readonly setSendingFor: (requestId: string | null) => void;
  /** Reports the accepted code to the parent. */
  readonly onSubmitted: (requestId: string) => void;
}

/**
 * Builds the submit closure for the request the prompt currently shows.
 *
 * A gate from the automatic path wins. A manual send gets the pairing gate, so
 * a Disconnect or a replacement cannot send the code to an importer the user
 * has just left.
 * @param context - The request, session, pairing, flight, and setters.
 * @returns The submit function.
 */
function createSubmit(
  context: SubmitContext,
): (candidate: string, beforeSend?: BeforeSend) => Promise<OtpSendResult> {
  const { requestId, connection, pairing, flight, setCode, setError, setSendingFor, onSubmitted } =
    context;

  return async (candidate, beforeSend) => {
    if (flight.current?.requestId === requestId) {
      return 'cancelled';
    }
    const prepared = prepareCode(candidate, connection, setError);
    if (prepared === null) {
      return 'failed';
    }
    const token = {};
    flight.current = { requestId, token };
    setSendingFor(requestId);
    setError(null);
    const outcome = await sendCode({
      session: prepared.session,
      requestId,
      code: prepared.code,
      beforeSend: beforeSend ?? pairingGate(pairing),
    });
    if (!isCurrentFlight(flight, token)) {
      // The prompt moved on while this POST was on its way: the outcome must
      // not clear another request's code, show its error, or report success.
      return 'cancelled';
    }
    flight.current = null;
    setSendingFor(null);
    return finishSubmission({ outcome, requestId, setCode, setError, onSubmitted });
  };
}

/**
 * Owns the one network write the prompt performs.
 *
 * The countdown and the button can both reach `submit` in the same tick, and a
 * state flag does not become true until React re-renders. A ref closes that
 * gap, which is worth a bank attempt.
 * @param requestId - The pending request being answered.
 * @param pairing - The pairing that owns the request's session.
 * @param onSubmitted - Called after the importer accepts a code.
 * @returns The submit state and controls.
 */
export function useOtpSubmission(
  requestId: string,
  pairing: number,
  onSubmitted: (requestId: string) => void,
): OtpSubmission {
  const { connection } = useAuth();
  const [code, setCode] = useState('');
  // Which request is showing the loading state. Naming the request rather
  // than holding a boolean makes a replacement request start unburdened.
  const [sendingFor, setSendingFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const flightRef = useSubmissionFlight(requestId);

  // Starting a send for another request must not leave this request's button
  // loading, even when the old send is still on its way. Adjusting state during
  // render keeps the stale value out of the committed tree.
  if (sendingFor !== null && sendingFor !== requestId) {
    setSendingFor(null);
  }

  const submit = createSubmit({
    requestId,
    connection,
    pairing,
    flight: flightRef,
    setCode,
    setError,
    setSendingFor,
    onSubmitted,
  });

  return {
    code,
    setCode,
    submitting: sendingFor === requestId,
    error,
    setError,
    submit,
  };
}
