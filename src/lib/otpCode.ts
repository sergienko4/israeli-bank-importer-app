/**
 * OTP code helpers keep one-time-code validation pure, testable, and separate
 * from the prompt UI so codes are never logged or normalized in side effects.
 */

const OTP_CODE_RE = /^\d{4,8}$/;

/**
 * Keeps only decimal digits from OTP input and caps it to the importer limit.
 * @param text - Raw input from the OTP field.
 * @returns A digits-only code candidate with at most eight characters.
 */
export function normalizeOtpCodeInput(text: string): string {
  return text.replace(/\D/g, '').slice(0, 8);
}

/**
 * Checks whether an OTP code can be submitted to the importer.
 * @param code - The normalized OTP code candidate.
 * @returns True when the code is 4-8 decimal digits.
 */
export function isValidOtpCode(code: string): boolean {
  return OTP_CODE_RE.test(code);
}
