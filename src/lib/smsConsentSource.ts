/**
 * Adapts the native SMS consent module to the capture seam.
 *
 * Kept separate from both sides so it can be tested without a device: the
 * awkward parts here are ordering and failure, not Android.
 */
import { noopOtpCaptureSource, type OtpCaptureSource } from './otpCapture';

/** A handle for removing an event listener. */
export interface SmsConsentSubscription {
  remove: () => void;
}

/**
 * The slice of the native module this adapter uses.
 *
 * Declared structurally so tests can supply a fake, and so the adapter cannot
 * quietly start depending on more of the native surface than it needs.
 */
export interface SmsConsentBinding {
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
  addListener: (
    event: 'onOtpMessage',
    listener: (payload: { body: string }) => void,
  ) => SmsConsentSubscription;
}

/**
 * Builds a capture source backed by the OS consent dialog.
 * @param binding - The native module, or null where the platform has none.
 * @returns A source that yields approved message bodies, or an inert one.
 */
export function createSmsConsentSource(binding: SmsConsentBinding | null): OtpCaptureSource {
  if (binding === null) {
    return noopOtpCaptureSource;
  }
  return { start: (onMessage) => listen(binding, onMessage) };
}

/**
 * Opens a consent window and returns the function that closes it.
 * @param binding - The native module to listen through.
 * @param onMessage - Called with each approved message body.
 * @returns A function that closes the window exactly once.
 */
function listen(binding: SmsConsentBinding, onMessage: (body: string) => void): () => void {
  const subscription = binding.addListener('onOtpMessage', ({ body }) => {
    onMessage(body);
  });
  // A refusal here is ordinary - no play services, or the OS declined - and
  // means the user types the code. It must never surface as a crash.
  const opened = binding.startListening().catch(() => undefined);

  let closed = false;
  return () => {
    if (closed) {
      return;
    }
    closed = true;
    subscription.remove();
    // Queue the close behind the open. Closing a window the OS has not
    // finished opening leaves it open, which is the one outcome this seam
    // exists to prevent.
    void opened.then(() => binding.stopListening()).catch(() => undefined);
  };
}
