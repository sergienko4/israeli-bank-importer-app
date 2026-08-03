import { NativeModule, requireOptionalNativeModule } from 'expo';

/**
 * The native SMS User Consent binding.
 *
 * Android-only by design, and even there it is optional: a build without play
 * services still resolves, it just never delivers a message.
 *
 * The event map is written inline because expo's `EventsMap` constraint needs
 * an implicit index signature, which an interface does not provide.
 */
declare class OtpSmsConsentNativeModule extends NativeModule<{
  /** Carries a message the user approved, exactly as the OS delivered it. */
  onOtpMessage: (payload: { body: string }) => void;
}> {
  /** Opens a consent listening window. Rejects when the OS declines to open one. */
  startListening(): Promise<void>;
  /** Closes the listening window. Safe to call when none is open. */
  stopListening(): Promise<void>;
  /**
   * Lets the auto-read receiver examine messages until `expiresAtMillis`.
   *
   * Only meaningful in a build carrying the auto-read receiver; elsewhere it
   * writes a value nothing reads. Synchronous because it must be durable
   * before the request that provokes the code is sent.
   */
  openAutoReadWindow(expiresAtMillis: number): void;
  /** Stops the auto-read receiver examining messages. Safe to call when idle. */
  closeAutoReadWindow(): void;
}

/**
 * The module for this platform, or null where it does not exist (iOS, web).
 *
 * Callers must treat null as "no capture available" rather than an error: on
 * iOS the OS keyboard already offers the code, and everywhere else the user
 * types it by hand.
 */
export default requireOptionalNativeModule<OtpSmsConsentNativeModule>('OtpSmsConsent');
