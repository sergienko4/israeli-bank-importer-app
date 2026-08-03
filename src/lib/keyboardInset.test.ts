/**
 * Unit tests for the keyboard offset arithmetic.
 *
 * The cases below are the ones that actually shipped as bugs elsewhere: the
 * sticky save bar that hides the field it was scrolled clear of, the
 * gesture-navigation double-count, and the mid-transition `NaN` that turns a
 * style into a crash.
 */
import { computeFocusedFieldOffset, computeStickyFooterOffset } from './keyboardInset';

describe('computeFocusedFieldOffset', () => {
  it('reserves room for the sticky cluster plus the breathing gap', () => {
    expect(computeFocusedFieldOffset({ footerHeight: 64, extraGap: 12 })).toBe(76);
  });

  it('is just the gap when the screen has no footer', () => {
    expect(computeFocusedFieldOffset({ footerHeight: 0, extraGap: 12 })).toBe(12);
  });

  it('ignores the keyboard, which the aware container adds itself', () => {
    // Guards the contract that made this a separate function: passing the
    // keyboard height in here would double-count it against bottomOffset.
    expect(computeFocusedFieldOffset({ footerHeight: 64, extraGap: 12 })).toBeLessThan(300);
  });

  it('clamps an unmeasured footer rather than emitting NaN', () => {
    expect(computeFocusedFieldOffset({ footerHeight: Number.NaN, extraGap: 12 })).toBe(12);
    expect(
      computeFocusedFieldOffset({ footerHeight: Number.POSITIVE_INFINITY, extraGap: 12 }),
    ).toBe(12);
    expect(computeFocusedFieldOffset({ footerHeight: -64, extraGap: 12 })).toBe(12);
  });

  it('clamps a sum that overflows even though both terms are finite', () => {
    // Two finite doubles can still add up to Infinity, and this is the only
    // place in the module where two measurements are combined.
    expect(
      computeFocusedFieldOffset({
        footerHeight: Number.MAX_VALUE,
        extraGap: Number.MAX_VALUE,
      }),
    ).toBe(0);
  });
});

describe('computeStickyFooterOffset', () => {
  it('cancels the safe-area padding the sticky view would otherwise double-count', () => {
    expect(computeStickyFooterOffset(34)).toBe(34);
  });

  it('is zero on a device without a bottom inset', () => {
    expect(computeStickyFooterOffset(0)).toBe(0);
  });

  it('clamps hostile insets to zero', () => {
    expect(computeStickyFooterOffset(Number.NaN)).toBe(0);
    expect(computeStickyFooterOffset(Number.POSITIVE_INFINITY)).toBe(0);
    expect(computeStickyFooterOffset(-34)).toBe(0);
  });
});
