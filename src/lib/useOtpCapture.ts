/**
 * React binding for the one-time-code capture seam.
 *
 * This file is deliberately thin: it owns only the listen *window* — start when
 * a request is on screen, stop when it is not — because an app that can read
 * one-time-code messages at any moment is a larger target than one that can
 * read them for the few seconds it is asking for a code. Everything that
 * decides what a message means lives in {@link startOtpCapture}, where it is
 * tested without a device.
 */
import { useEffect, useRef } from 'react';

import OtpSmsConsentModule from '../../modules/otp-sms-consent/src/OtpSmsConsentModule';
import { type OtpCaptureSource, startOtpCapture } from './otpCapture';
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
    return startOtpCapture(platformSource, (code: string) => {
      deliver.current(code);
    });
  }, [active]);
}
