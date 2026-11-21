/**
 * The cancelable window before an automatically captured OTP code is sent.
 *
 * The armed value carries its own request id, so a new request cannot inherit
 * the previous one's countdown.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** How long the user has to stop an automatic submission. */
export const AUTO_SUBMIT_DELAY_SECONDS = 3;

/** What the countdown needs in order to stay tied to one visible request. */
export interface CountdownOptions {
  /** The pending request the armed code belongs to. */
  readonly requestId: string;
  /** Whether the sheet is on screen. */
  readonly visible: boolean;
  /** Called with the armed code once the window elapses. */
  readonly onFire: (code: string) => void;
}

/** The countdown state the prompt renders and drives. */
export interface Countdown {
  /** Whether a code is waiting to be sent. */
  readonly pending: boolean;
  /** Seconds left in the cancel window. */
  readonly secondsLeft: number;
  /** Starts the window for a code. */
  readonly arm: (code: string) => void;
  /** Stops the window before anything reaches the network. */
  readonly cancel: () => void;
}

/**
 * Holds an armed code for a few seconds so the user can stop it.
 * @param options - The request the code belongs to, and what to do on expiry.
 * @returns The countdown state and its controls.
 */
export function useAutoSubmitCountdown({
  requestId,
  visible,
  onFire,
}: CountdownOptions): Countdown {
  const [armed, setArmed] = useState<{ requestId: string; code: string } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(AUTO_SUBMIT_DELAY_SECONDS);
  const fireRef = useRef(onFire);

  useEffect(() => {
    fireRef.current = onFire;
  });

  const active = armed !== null && armed.requestId === requestId && visible ? armed : null;

  useEffect(() => {
    if (active === null) {
      return undefined;
    }
    const timer = setTimeout(() => {
      if (secondsLeft <= 1) {
        setArmed(null);
        fireRef.current(active.code);
      } else {
        setSecondsLeft((left) => left - 1);
      }
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [active, secondsLeft]);

  const arm = useCallback(
    (code: string): void => {
      setSecondsLeft(AUTO_SUBMIT_DELAY_SECONDS);
      setArmed({ requestId, code });
    },
    [requestId],
  );
  const cancel = useCallback((): void => {
    setArmed(null);
  }, []);

  return { pending: active !== null, secondsLeft, arm, cancel };
}
