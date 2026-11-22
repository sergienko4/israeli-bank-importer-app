/**
 * Automatic OTP send orchestration: the stored opt-in read and the guarded
 * fire callback shared by the prompt and its countdown.
 */
import { useEffect, useState } from 'react';

import type { BeforeSend } from '../api/authedTypes';
import { autoSendGate } from './autoSendGate';
import { type OtpSendResult, submitIfCurrent } from './autoSubmitAttempt';
import { loadOtpAutoSubmit } from './otpAutoSubmitStore';
import type { AutoSubmitGuard } from './useAutoSubmitGuard';

/**
 * Reads the stored auto-submit opt-in each time the sheet opens.
 *
 * Re-reading on open matters in the unsafe direction: the prompt can stay
 * mounted across requests, so a user who turns the setting *off* in Settings
 * must not find the next code still leaving on its own. Until the read lands
 * the answer is false, so a slow read costs a button press, never a surprise.
 * @param visible - Whether the sheet is on screen.
 * @returns Whether automatic submission is enabled.
 */
export function useAutoSubmitPreference(visible: boolean): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!visible) {
      return undefined;
    }
    let active = true;
    const run = async (): Promise<void> => {
      const stored = await loadOtpAutoSubmit();
      if (active) {
        setEnabled(stored);
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [visible]);
  return enabled;
}

/** What one automatic send needs from the prompt. */
export interface AutoFireOptions {
  /** The prompt's attempt guard. */
  readonly autoGuard: AutoSubmitGuard;
  /** The generation captured when the code was armed. */
  readonly token: number;
  /** The importer pairing captured when the code was armed. */
  readonly pairing: number;
  /** The send function. */
  readonly submit: (code: string, beforeSend?: BeforeSend) => Promise<OtpSendResult>;
  /** Shows the fallback when nothing left. */
  readonly setError: (message: string | null) => void;
}

/**
 * Fires one automatic send and reports a gate that withdrew it.
 * @param options - The guard, armed generation, send, and error setter.
 * @returns The countdown's fire callback.
 */
export function autoFire({
  autoGuard,
  token,
  pairing,
  submit,
  setError,
}: AutoFireOptions): (value: string) => void {
  return (value) => {
    const attempt = autoGuard.currentAttempt();
    void submitIfCurrent({
      attempt,
      token,
      readPreference: loadOtpAutoSubmit,
      send: (candidate) => submit(candidate, autoSendGate(attempt, token, pairing)),
      code: value,
    }).then((result) => {
      if (result === 'cancelled' && attempt.isCurrent(token)) {
        setError('Auto-send stopped. Press Submit code.');
      }
    });
  };
}
