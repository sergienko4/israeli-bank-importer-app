/**
 * Property-based tests for the OTP helpers (OpenSSF Scorecard: Fuzzing).
 *
 * Example-based tests only prove the cases we thought of. These properties hold
 * for every string fast-check can produce, including Unicode digits, control
 * characters, and very long inputs — the shapes a paste from an SMS app or a
 * hostile deep link can realistically deliver.
 */
import * as fc from 'fast-check';

import { isOtpFillEvent, isValidOtpCode, normalizeOtpCodeInput } from './otpCode';

describe('normalizeOtpCodeInput properties', () => {
  it('always yields at most eight ASCII digits', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const result = normalizeOtpCodeInput(text);
        expect(result).toMatch(/^\d*$/);
        expect(result.length).toBeLessThanOrEqual(8);
      }),
    );
  });

  it('is idempotent, so re-normalizing a field value never changes it', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const once = normalizeOtpCodeInput(text);
        expect(normalizeOtpCodeInput(once)).toBe(once);
      }),
    );
  });

  it('preserves the leading digits of the input in order', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const digits = (text.match(/\d/g) ?? []).join('');
        expect(normalizeOtpCodeInput(text)).toBe(digits.slice(0, 8));
      }),
    );
  });

  it('never throws, whatever the user pastes into the field', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 4096 }), (text) => {
        expect(() => normalizeOtpCodeInput(text)).not.toThrow();
      }),
    );
  });
});

describe('isValidOtpCode properties', () => {
  it('accepts exactly the four-to-eight digit codes', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const expected = /^\d{4,8}$/.test(text);
        expect(isValidOtpCode(text)).toBe(expected);
      }),
    );
  });

  it('accepts every code the importer can generate', () => {
    const digitString = fc
      .array(fc.integer({ min: 0, max: 9 }), { minLength: 4, maxLength: 8 })
      .map((digits) => digits.join(''));
    fc.assert(
      fc.property(digitString, (code) => {
        expect(isValidOtpCode(code)).toBe(true);
      }),
    );
  });

  it('rejects anything containing a non-digit, so codes stay submit-safe', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        if (/\D/.test(text)) {
          expect(isValidOtpCode(text)).toBe(false);
        }
      }),
    );
  });
});

describe('isOtpFillEvent properties', () => {
  const digitString = (min: number, max: number) =>
    fc
      .array(fc.integer({ min: 0, max: 9 }), { minLength: min, maxLength: max })
      .map((digits) => digits.join(''));

  it('never fires while typing, for every code of every length', () => {
    // Generalises the headline example test: for ANY 4-8 digit code, entering
    // it one digit at a time must not produce a fill event at any prefix.
    fc.assert(
      fc.property(digitString(4, 8), (code) => {
        for (let index = 0; index < code.length; index += 1) {
          expect(isOtpFillEvent(code.slice(0, index), code.slice(0, index + 1))).toBe(false);
        }
      }),
    );
  });

  it('only ever fires on a value that is safe to submit', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (previous, next) => {
        if (isOtpFillEvent(previous, next)) {
          expect(isValidOtpCode(next)).toBe(true);
        }
      }),
    );
  });

  it('never fires when the value did not grow by at least two digits', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (previous, next) => {
        if (next.length - previous.length < 2) {
          expect(isOtpFillEvent(previous, next)).toBe(false);
        }
      }),
    );
  });

  it('never throws, whatever pair of values the field produces', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 4096 }), fc.string({ maxLength: 4096 }), (a, b) => {
        expect(() => isOtpFillEvent(a, b)).not.toThrow();
      }),
    );
  });
});
