/** The wire shape of one foreground OTP submission. */
import type { BeforeSend } from './authedTypes';
import type { Session } from './session';

/** One foreground OTP submission. */
export interface OtpSubmissionRequest {
  /** The active session. */
  readonly session: Session;
  /** The pending request id. */
  readonly id: string;
  /** The code the user is submitting. */
  readonly code: string;
  /** Orders the final opt-in read and POST start after every wait. */
  readonly beforeSend?: BeforeSend;
}

/**
 * Builds the POST for one OTP code.
 * @param id - The pending request id.
 * @param code - The code to submit.
 * @returns The API path and fetch init.
 */
export function otpSubmission(id: string, code: string): { path: string; init: RequestInit } {
  return {
    path: `/api/otp/${encodeURIComponent(id)}`,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    },
  };
}
