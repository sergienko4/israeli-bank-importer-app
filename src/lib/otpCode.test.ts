import { isValidOtpCode, normalizeOtpCodeInput } from './otpCode';

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
