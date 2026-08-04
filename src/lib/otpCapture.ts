/**
 * The seam between the OS one-time-code capture and the OTP prompt.
 *
 * Keeping the source behind an interface means the app never depends on a
 * native module directly: the default source below does nothing, so the whole
 * capture path exists, is tested, and is inert until a platform implementation
 * is supplied. It also means the security-relevant behaviour — what gets past
 * the extractor, and how often — is plain testable TypeScript rather than
 * something only reachable on a device.
 *
 * The captured body stops here. It is turned into digits by
 * {@link extractOtpCode} and dropped in the same expression, so it never
 * reaches React state, storage, a log, or the network.
 */
import { extractOtpCode } from './otpMessage';

/** A platform that can hand the app a one-time-code message. */
export interface OtpCaptureSource {
  /**
   * Begins listening for a one-time-code message.
   * @param onMessage - Called with each captured message body.
   * @returns A function that stops listening.
   */
  readonly start: (onMessage: (body: string) => void) => () => void;
}

/**
 * The source used where no platform capture exists.
 *
 * It is not a placeholder to be replaced everywhere: iOS has no equivalent of
 * Android's consent flow, and Android without Play Services cannot offer one
 * either, so this stays the real answer on those devices and the user types the
 * code as before.
 */
export const noopOtpCaptureSource: OtpCaptureSource = {
  start: () => (): void => undefined,
};

/**
 * Listens for a one-time-code message and reports the code it contains.
 *
 * At most one code is reported per listen window. A message stream is not
 * trustworthy — an attacker can send several — and retrying against the bank
 * is exactly what must not happen, so the first readable code closes the
 * window's output. Messages that carry no unambiguous code are discarded
 * without ending the window, since the real bank message may still arrive.
 *
 * @param source - The platform capture to listen through.
 * @param onCode - Called at most once with the extracted code.
 * @returns A function that stops listening.
 */
export function startOtpCapture(
  source: OtpCaptureSource,
  onCode: (code: string) => void,
): () => void {
  let delivered = false;
  return source.start((body: string) => {
    if (delivered) {
      return;
    }
    const code = extractOtpCode(body);
    if (code === null) {
      return;
    }
    delivered = true;
    onCode(code);
  });
}
