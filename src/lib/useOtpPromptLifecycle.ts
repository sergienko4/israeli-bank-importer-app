/**
 * Request- and visibility-scoped resets for a prompt that outlives one request.
 *
 * The OTP prompt stays mounted while the importer moves between requests, so
 * anything the last request left behind has to be dropped when the request or
 * the sheet changes. Kept out of the screen so it stays within the project's
 * function-size and file-size caps.
 */
import { useLayoutEffect, useRef } from 'react';

import type { AutoSubmitGuard } from './useAutoSubmitGuard';

/** What the prompt's request and visibility effects reset. */
export interface PromptLifecycle {
  /** The pending request being answered. */
  readonly requestId: string;
  /** Whether the sheet is on screen. */
  readonly visible: boolean;
  /** The prompt's attempt guard. */
  readonly autoGuard: AutoSubmitGuard;
  /** Stops an armed countdown. */
  readonly cancelCountdown: () => void;
  /** Replaces the code text. */
  readonly setCode: (code: string) => void;
  /** Clears the failure. */
  readonly setError: (error: string | null) => void;
}

/**
 * Scopes the code, error, countdown, and guard to one request and to the time
 * the sheet is on screen.
 *
 * A different request must not inherit the last code, and a hidden sheet must
 * not keep an armed code that would send when the same request reappears.
 * @param lifecycle - The request, visibility, guard, and reset callbacks.
 */
export function usePromptLifecycle({
  requestId,
  visible,
  autoGuard,
  cancelCountdown,
  setCode,
  setError,
}: PromptLifecycle): void {
  const activeRequest = useRef(requestId);

  useLayoutEffect(() => {
    if (activeRequest.current === requestId) {
      return;
    }
    activeRequest.current = requestId;
    setCode('');
    setError(null);
    cancelCountdown();
  }, [requestId, cancelCountdown, setCode, setError]);

  useLayoutEffect(() => {
    if (!visible) {
      autoGuard.invalidate();
      cancelCountdown();
    }
  }, [visible, autoGuard, cancelCountdown]);
}
