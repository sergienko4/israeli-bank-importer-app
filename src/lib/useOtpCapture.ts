/**
 * React binding for the one-time-code capture seam.
 *
 * This file is deliberately thin: it owns only the listen *window* — start when
 * a request is on screen, stop when it is not — because an app that can read
 * one-time-code messages at any moment is a larger target than one that can
 * read them for the few seconds it is asking for a code. Everything that
 * decides what a message means lives in {@link startOtpCapture}, where it is
 * tested without a device.
 *
 * It also owns *whether* to listen at all. When the native auto-read window is
 * live the receiver already answers the same message, so opening a consent
 * window too would ask the user to approve reading a code that has already
 * been sent. {@link loadOtpCaptureMode} is what draws that line.
 */
import { useEffect, useRef } from 'react';

import OtpSmsConsentModule from '../../modules/otp-sms-consent/src/OtpSmsConsentModule';
import { type OtpCaptureSource, startOtpCapture } from './otpCapture';
import { loadOtpCaptureMode } from './otpCaptureMode';
import { createSmsConsentSource } from './smsConsentSource';

/**
 * The capture this build listens through.
 *
 * Resolves to the Android consent module where it exists and to an inert
 * source everywhere else, so no caller needs a platform check.
 */
const platformSource: OtpCaptureSource = createSmsConsentSource(OtpSmsConsentModule);

/**
 * Listens for a one-time-code message for as long as a request is on screen.
 * @param active - Whether the app is currently asking for a code.
 * @param onCode - Called with a captured code, at most once per listen window.
 */
export function useOtpCapture(active: boolean, onCode: (code: string) => void): void {
  // Read the callback through a ref so a re-render cannot restart the window
  // and hand a second attacker message a fresh single-shot budget.
  const deliver = useRef(onCode);
  useEffect(() => {
    deliver.current = onCode;
  });

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    let stop: (() => void) | null = null;
    let cancelled = false;
    // Resolving the mode is asynchronous, so the window may be closed before
    // the answer arrives; `cancelled` is what stops it opening after the fact.
    void loadOtpCaptureMode(OtpSmsConsentModule !== null).then((mode) => {
      if (cancelled || mode !== 'consent') {
        return;
      }
      stop = startOtpCapture(platformSource, (code: string) => {
        deliver.current(code);
      });
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [active]);
}
