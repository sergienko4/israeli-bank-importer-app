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

/**
 * The fewest digits a single change must add before it counts as a fill rather
 * than a keystroke. One digit is a key press; two or more can only arrive from
 * a paste, an autofill suggestion, or an SMS capture.
 */
const MIN_FILL_INSERTION = 2;

/**
 * Decides whether a field change was a *fill* - a code arriving whole from
 * autofill, a paste, or an SMS capture - rather than the user typing.
 *
 * Auto-submit is gated on this so that entering a code by hand can never
 * trigger it. Typing the fourth digit of a six-digit code produces a
 * momentarily valid value, and submitting that truncated code would spend one
 * of the bank's few attempts.
 *
 * The check fails closed: a change it cannot confidently attribute to a fill,
 * such as a deletion or a replacement that shortens the value, stays manual.
 * Missing a fill costs one tap, whereas a false fill costs a bank attempt.
 *
 * @param previous - Field value before the change, already normalized.
 * @param next - Field value after the change, already normalized.
 * @returns True when the change added at least two digits and landed on a submittable code.
 */
export function isOtpFillEvent(previous: string, next: string): boolean {
  return next.length - previous.length >= MIN_FILL_INSERTION && isValidOtpCode(next);
}
