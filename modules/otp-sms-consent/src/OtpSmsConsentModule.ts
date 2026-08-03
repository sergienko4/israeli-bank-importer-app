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
  /**
   * Every message held because it arrived before a code was asked for.
   *
   * Expired entries are pruned as a side effect, so the answer is always the
   * set that may still be acted on.
   */
  listStashedMessages(): Promise<NativeStashedMessage[]>;
  /** Drops a held message for good, once its code has been accepted. */
  consumeStashedMessage(id: string): Promise<void>;
  /**
   * Records that a held message was already sent against one request.
   *
   * This is what stops a code the importer rejected being sent again, which
   * would spend the bank's few attempts on an answer known to be wrong.
   */
  markStashAttempt(id: string, requestId: string): Promise<void>;
  /** Forgets every held message. Safe to call when none are held. */
  clearStash(): Promise<void>;
  /**
   * Mirrors the user's auto-read preference natively.
   *
   * The receiver consults this before holding anything, so a refusal costs no
   * JavaScript at all. Passing false also empties the stash. Synchronous
   * because it must be durable before the next message can arrive.
   */
  setStashEnabled(enabled: boolean): void;
}

/** One held message, exactly as the native record delivers it. */
export interface NativeStashedMessage {
  /** Content-derived identity, stable across a redelivered broadcast. */
  id: string;
  /** The raw text, unparsed. */
  body: string;
  /** Originating address, as the network gave it. */
  sender: string;
  /** When the network handed the message over, epoch milliseconds. */
  receivedAt: number;
  /** Requests this message has already been submitted against. */
  attempted: string[];
}

/**
 * The module for this platform, or null where it does not exist (iOS, web).
 *
 * Callers must treat null as "no capture available" rather than an error: on
 * iOS the OS keyboard already offers the code, and everywhere else the user
 * types it by hand.
 */
export default requireOptionalNativeModule<OtpSmsConsentNativeModule>('OtpSmsConsent');
