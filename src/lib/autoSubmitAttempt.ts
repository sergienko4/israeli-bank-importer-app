/**
 * Guards one automatic OTP submission.
 *
 * Re-reading the opt-in is asynchronous. Without a generation token, a code
 * could still leave after the user edited the field, cancelled the countdown,
 * dismissed the sheet, submitted by hand, or left the prompt entirely.
 */

/** A generation tracker for one armed code. */
export interface AutoSubmitAttempt {
  /** The current generation. */
  readonly token: number;
  /** Invalidates every token captured before this call. */
  invalidate: () => void;
  /** Reports whether a captured token is still current. */
  isCurrent: (token: number) => boolean;
}

/**
 * Creates a tracker at generation zero.
 * @returns The tracker.
 */
export function createAutoSubmitAttempt(): AutoSubmitAttempt {
  let token = 0;
  return {
    get token(): number {
      return token;
    },
    invalidate: (): void => {
      token += 1;
    },
    isCurrent: (candidate: number): boolean => candidate === token,
  };
}

/** What a guarded automatic submission needs. */
export interface AutoSubmitCheck {
  /** The attempt tracker. */
  readonly attempt: AutoSubmitAttempt;
  /** The generation captured before the preference read. */
  readonly token: number;
  /** Reads the current opt-in. */
  readonly readPreference: () => Promise<boolean>;
  /** Sends the code. */
  readonly send: (code: string) => Promise<void>;
  /** The armed code. */
  readonly code: string;
}

/**
 * Sends an armed code only if the opt-in is still on and the attempt is current.
 * @param check - The tracker, captured token, preference read, send, and code.
 * @returns True when the code was sent.
 */
export async function submitIfCurrent(check: AutoSubmitCheck): Promise<boolean> {
  // A read that fails cannot confirm the user still wants automatic sending,
  // so it counts as opted out rather than surfacing an unhandled rejection.
  const enabled = await check.readPreference().catch(() => false);
  if (!enabled || !check.attempt.isCurrent(check.token)) {
    return false;
  }
  await check.send(check.code);
  return true;
}
