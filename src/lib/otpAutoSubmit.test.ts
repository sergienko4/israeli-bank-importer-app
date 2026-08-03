/**
 * Tests for the automatic-submit arming gate.
 *
 * The gate spends a bank attempt when it fires, so each test below names one
 * reason to stay manual. A change that makes any of these pass automatically is
 * a regression even if the app still "works".
 */
import * as fc from 'fast-check';

import { shouldArmAutoSubmit } from './otpAutoSubmit';

const FILL = { previous: '', next: '123456' } as const;

describe('shouldArmAutoSubmit', () => {
  it('arms when the user opted in and a whole code arrives at once', () => {
    expect(shouldArmAutoSubmit({ enabled: true, alreadyArmed: false, ...FILL })).toBe(true);
  });

  it('stays manual when the user has not opted in', () => {
    expect(shouldArmAutoSubmit({ enabled: false, alreadyArmed: false, ...FILL })).toBe(false);
  });

  it('stays manual when this request already armed once', () => {
    expect(shouldArmAutoSubmit({ enabled: true, alreadyArmed: true, ...FILL })).toBe(false);
  });

  it('stays manual while the user types the code one digit at a time', () => {
    const typed = ['', '1', '12', '123', '1234', '12345', '123456'];
    const armed = typed.slice(1).map((next, index) =>
      shouldArmAutoSubmit({
        enabled: true,
        alreadyArmed: false,
        previous: typed[index] ?? '',
        next,
      }),
    );
    expect(armed).toEqual([false, false, false, false, false, false]);
  });

  it('stays manual when the pasted value is not a usable code', () => {
    expect(
      shouldArmAutoSubmit({ enabled: true, alreadyArmed: false, previous: '', next: '12' }),
    ).toBe(false);
  });

  it('never arms while disabled, whatever the field does', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.boolean(), (previous, next, alreadyArmed) => {
        expect(shouldArmAutoSubmit({ enabled: false, alreadyArmed, previous, next })).toBe(false);
      }),
    );
  });

  it('never arms twice for the same request, whatever the field does', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.boolean(), (previous, next, enabled) => {
        expect(shouldArmAutoSubmit({ enabled, alreadyArmed: true, previous, next })).toBe(false);
      }),
    );
  });
});
