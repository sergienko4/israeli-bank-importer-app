/**
 * Types for the importer's app-based OTP endpoints. When the OTP delivery
 * channel is set to `app`, the importer records pending OTP requests that the
 * app polls and answers, instead of prompting over Telegram.
 */

/** The OTP delivery channel: Telegram (default) or the mobile app. */
export type OtpChannel = 'telegram' | 'app';

/** The app-only OTP delivery settings. */
export interface OtpSettings {
  channel: OtpChannel;
}

/** A pending OTP request awaiting a code from the app (never carries the code). */
export interface PendingOtpRequest {
  /** Opaque request id the app submits its code against. */
  id: string;
  /** Bank id the OTP is for (shown to the user). */
  bankId: string;
  /** Creation time, epoch ms. */
  createdAt: number;
  /** Expiry time, epoch ms; the request is dead once now exceeds it. */
  deadline: number;
}
