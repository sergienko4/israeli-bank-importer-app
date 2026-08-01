/**
 * Types for the importer's app-based OTP endpoints. When the OTP delivery
 * channel is set to `app`, the importer records pending OTP requests that the
 * app polls and answers, instead of prompting over Telegram.
 *
 * The shapes come from the importer's own contract rather than a copy kept
 * here, so the 4-8 digit code rule and the channel values are declared once.
 */

export type { OtpChannel, OtpSettings, PendingOtpRequest } from './generated';
