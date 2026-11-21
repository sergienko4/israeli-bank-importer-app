/** The wire shape of one foreground OTP submission. */
import type { Session } from './importerClient';

/** One foreground OTP submission. */
export interface OtpSubmissionRequest {
  /** The active session. */
  readonly session: Session;
  /** The pending request id. */
  readonly id: string;
  /** The code the user is submitting. */
  readonly code: string;
  /** Re-checks intent after the lane and session renewal, before the POST. */
  readonly beforeSend?: () => Promise<boolean>;
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
