/**
 * Abuse cases for the SMS one-time-code extractor.
 *
 * These are written before the extractor exists, and they are deliberately
 * adversarial: the input is a text message, which anyone who knows the user's
 * number can send. A wrong extraction feeds the auto-submit path and spends one
 * of the bank's few attempts, so every ambiguous message must resolve to null
 * and leave the user typing.
 */
import { extractOtpCode, MAX_MESSAGE_LENGTH } from './otpMessage';

describe('extractOtpCode — messages a bank really sends', () => {
  it('reads the code out of a Hebrew verification message', () => {
    expect(extractOtpCode('קוד האימות שלך הוא 483920')).toBe('483920');
  });

  it('reads the code out of an English verification message', () => {
    expect(extractOtpCode('Your verification code is 483920. Do not share it.')).toBe('483920');
  });

  it('reads a code that opens the message', () => {
    expect(extractOtpCode('483920 is your one-time code')).toBe('483920');
  });

  it('accepts the shortest and longest codes the importer allows', () => {
    expect(extractOtpCode('Code: 4839')).toBe('4839');
    expect(extractOtpCode('Code: 48392017')).toBe('48392017');
  });

  it('reads a code wrapped in bidirectional marks', () => {
    expect(extractOtpCode('\u200fקוד: \u200e483920\u200f')).toBe('483920');
  });

  it('accepts the same code repeated, which many banks do', () => {
    expect(extractOtpCode('Code 483920. Never share 483920 with anyone.')).toBe('483920');
  });
});

describe('extractOtpCode — messages that must not yield a code', () => {
  it('refuses a message offering two different codes', () => {
    expect(extractOtpCode('Code 483920 expired, use 517204 instead')).toBeNull();
  });

  it('refuses digits that are part of a longer run, such as an account number', () => {
    expect(extractOtpCode('Account 12345678901 was debited')).toBeNull();
  });

  it('refuses a run that is too short to be a code', () => {
    expect(extractOtpCode('Only 483 left')).toBeNull();
  });

  it('refuses a run that is too long to be a code', () => {
    expect(extractOtpCode('Reference 483920175')).toBeNull();
  });

  it('refuses a code split by punctuation, because the halves are not codes', () => {
    expect(extractOtpCode('Your code is 483-920')).toBeNull();
  });

  it('refuses a message with no digits at all', () => {
    expect(extractOtpCode('Your account statement is ready')).toBeNull();
  });

  it('refuses empty and whitespace-only messages', () => {
    expect(extractOtpCode('')).toBeNull();
    expect(extractOtpCode('   \n\t ')).toBeNull();
  });

  it('refuses an oversized body rather than scanning it', () => {
    const padding = 'a'.repeat(MAX_MESSAGE_LENGTH);
    expect(extractOtpCode(`${padding} 483920`)).toBeNull();
  });

  it('refuses look-alike digits from other scripts', () => {
    expect(extractOtpCode('קוד: ٤٨٣٩٢٠')).toBeNull();
  });

  it('refuses a code hidden among unrelated four-digit numbers', () => {
    expect(extractOtpCode('Order 1234 total 5678')).toBeNull();
  });
});
