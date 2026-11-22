/**
 * Per-request guard for the OTP prompt's automatic submission.
 *
 * The guard has to survive the prompt's renders and be invalidated the moment
 * the prompt goes away, so the tracker lives in refs owned by a hook. Kept out
 * of the screen so the prompt stays within the project's function-size cap.
 */
import { useLayoutEffect, useMemo, useRef } from 'react';

import { type AutoSubmitAttempt, createAutoSubmitAttempt } from './autoSubmitAttempt';

/** The refs and invalidation shared by manual and automatic submission. */
export interface AutoSubmitGuard {
  /** Reports whether this request already armed. */
  isUsed: () => boolean;
  /** Records that this request used its attempt. */
  markUsed: () => void;
  /** Returns the current attempt tracker. */
  currentAttempt: () => AutoSubmitAttempt;
  /** Invalidates a pending automatic attempt. */
  invalidate: () => void;
}

/**
 * Keeps the one-shot guard and the auto-send generation across renders.
 * @param autoSubmitUsed - Whether the parent already recorded an attempt.
 * @param requestId - The pending request the guard belongs to.
 * @returns The guard reads and controls.
 */
export function useAutoSubmitGuard(autoSubmitUsed: boolean, requestId: string): AutoSubmitGuard {
  const used = useRef(autoSubmitUsed);
  const attempt = useRef(createAutoSubmitAttempt());
  const activeRequest = useRef(requestId);

  useLayoutEffect(() => {
    if (activeRequest.current !== requestId) {
      activeRequest.current = requestId;
      // A new request must not inherit the previous request's attempt or
      // consume its one automatic send.
      attempt.current.invalidate();
    }
    used.current = autoSubmitUsed;
  }, [autoSubmitUsed, requestId]);

  useLayoutEffect(
    () => () => {
      attempt.current.invalidate();
    },
    [],
  );

  return useMemo(
    () => ({
      isUsed: () => used.current,
      markUsed: () => {
        used.current = true;
      },
      currentAttempt: () => attempt.current,
      invalidate: () => {
        attempt.current.invalidate();
      },
    }),
    [],
  );
}
