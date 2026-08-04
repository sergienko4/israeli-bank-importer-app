import { isOtpFillEvent, isValidOtpCode, normalizeOtpCodeInput } from './otpCode';

describe('OTP code helpers', () => {
  it('keeps only digits and caps input at eight characters', () => {
    expect(normalizeOtpCodeInput(' 12-34 567 890 ')).toBe('12345678');
  });

  it('accepts 4-8 digit codes only', () => {
    expect(isValidOtpCode('1234')).toBe(true);
    expect(isValidOtpCode('12345678')).toBe(true);
    expect(isValidOtpCode('123')).toBe(false);
    expect(isValidOtpCode('123456789')).toBe(false);
    expect(isValidOtpCode('12a4')).toBe(false);
  });
});

describe('isOtpFillEvent', () => {
  it('never fires while a code is typed one digit at a time', () => {
    // The headline safety property. If this ever regresses, auto-submit would
    // send "1234" the moment the user typed the fourth digit of a six-digit
    // code, burning one of the bank's few attempts.
    const typed = ['1', '12', '123', '1234', '12345', '123456'];
    let previous = '';
    for (const next of typed) {
      expect(isOtpFillEvent(previous, next)).toBe(false);
      previous = next;
    }
  });

  it('fires when a whole code arrives in one event', () => {
    expect(isOtpFillEvent('', '123456')).toBe(true);
    expect(isOtpFillEvent('', '1234')).toBe(true);
    expect(isOtpFillEvent('', '12345678')).toBe(true);
  });

  it('fires when a fill replaces a partly typed code', () => {
    expect(isOtpFillEvent('12', '123456')).toBe(true);
  });

  it('fires on the smallest insertion a keystroke cannot produce', () => {
    // Two digits at once is the boundary: one is a key press, two can only come
    // from a paste, an autofill suggestion, or an SMS capture.
    expect(isOtpFillEvent('1234', '123456')).toBe(true);
  });

  it('does not fire when the filled value is not a submittable code', () => {
    expect(isOtpFillEvent('', '123')).toBe(false);
    expect(isOtpFillEvent('', '123456789')).toBe(false);
    expect(isOtpFillEvent('', '')).toBe(false);
  });

  it('does not fire on deletion, clearing, or an unchanged value', () => {
    expect(isOtpFillEvent('123456', '12345')).toBe(false);
    expect(isOtpFillEvent('123456', '')).toBe(false);
    expect(isOtpFillEvent('123456', '123456')).toBe(false);
  });

  it('does not fire when a shorter code replaces a longer one', () => {
    // A select-all-and-paste that shortens the value is indistinguishable from
    // an edit, so it stays manual. Failing closed costs one tap; failing open
    // could cost a bank attempt.
    expect(isOtpFillEvent('12345678', '1234')).toBe(false);
  });
});
