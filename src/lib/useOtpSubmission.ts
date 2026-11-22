/**
 * The OTP prompt's single network write.
 *
 * Kept out of the screen so the prompt stays within the project's function and
 * file caps, and so the accepted-code reset is testable with the submission.
 */
import { useRef, useState } from 'react';

import type { BeforeSend } from '../api/authedTypes';
import { type Session, submitOtp } from '../api/importerClient';
import { useAuth } from '../auth/AuthContext';
import { type OtpSendResult } from './autoSubmitAttempt';
import { reportedOrFallback } from './errorMessages';
import { haptics } from './haptics';
import { isValidOtpCode, normalizeOtpCodeInput } from './otpCode';

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
 * Owns the one network write the prompt performs.
 *
 * The countdown and the button can both reach `submit` in the same tick, and a
 * state flag does not become true until React re-renders. A ref closes that
 * gap, which is worth a bank attempt.
 * @param requestId - The pending request being answered.
 * @param onSubmitted - Called after the importer accepts a code.
 * @returns The submit state and controls.
 */
export function useOtpSubmission(
  requestId: string,
  onSubmitted: (requestId: string) => void,
): OtpSubmission {
  const { connection } = useAuth();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const submit = async (candidate: string, beforeSend?: BeforeSend): Promise<OtpSendResult> => {
    if (inFlight.current) {
      return 'cancelled';
    }
    const trimmed = normalizeOtpCodeInput(candidate);
    if (!isValidOtpCode(trimmed)) {
      setError('Enter the 4–8 digit app OTP code.');
      return 'failed';
    }
    if (!connection) {
      haptics.warning();
      setError('Reconnect to the importer, then enter the code again.');
      return 'failed';
    }
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    const outcome = await sendCode({ session: connection, requestId, code: trimmed, beforeSend });
    inFlight.current = false;
    setSubmitting(false);
    return finishSubmission({ outcome, requestId, setCode, setError, onSubmitted });
  };

  return { code, setCode, submitting, error, setError, submit };
}
