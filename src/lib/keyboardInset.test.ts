/**
 * Unit tests for the keyboard offset arithmetic.
 *
 * The cases below are the ones that actually shipped as bugs elsewhere: the
 * sticky save bar that hides the field it was scrolled clear of, the
 * gesture-navigation double-count, and the mid-transition `NaN` that turns a
 * style into a crash.
 */
import {
  computeFocusedFieldOffset,
  computeSheetMaxHeight,
  computeStickyFooterOffset,
} from './keyboardInset';

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

describe('computeSheetMaxHeight', () => {
  it('budgets against the whole window while the keyboard is closed', () => {
    expect(computeSheetMaxHeight({ windowHeight: 800, keyboardHeight: 0, ratio: 0.8 })).toBe(640);
  });

  it('leaves the lifted panel fully on screen once the keyboard opens', () => {
    // The bug this guards: 800 * 0.8 = 640 lifted by 320 starts 160 dp above
    // the top of an 800 dp window, taking the title and close affordance with it.
    const maxHeight = computeSheetMaxHeight({
      windowHeight: 800,
      keyboardHeight: 320,
      ratio: 0.8,
    });
    expect(maxHeight).toBe(384);
    expect(maxHeight + 320).toBeLessThanOrEqual(800);
  });

  it('treats an implausible keyboard as unmeasured rather than collapsing', () => {
    expect(computeSheetMaxHeight({ windowHeight: 800, keyboardHeight: 800, ratio: 0.8 })).toBe(640);
    expect(computeSheetMaxHeight({ windowHeight: 800, keyboardHeight: 900, ratio: 0.8 })).toBe(640);
  });

  it('clamps hostile measurements rather than emitting NaN', () => {
    expect(
      computeSheetMaxHeight({ windowHeight: 800, keyboardHeight: Number.NaN, ratio: 0.8 }),
    ).toBe(640);
    expect(
      computeSheetMaxHeight({ windowHeight: Number.NaN, keyboardHeight: 320, ratio: 0.8 }),
    ).toBe(0);
  });

  it('falls back to the full share for a nonsensical ratio', () => {
    expect(computeSheetMaxHeight({ windowHeight: 800, keyboardHeight: 320, ratio: 0 })).toBe(480);
    expect(computeSheetMaxHeight({ windowHeight: 800, keyboardHeight: 320, ratio: 4 })).toBe(480);
    expect(
      computeSheetMaxHeight({ windowHeight: 800, keyboardHeight: 320, ratio: Number.NaN }),
    ).toBe(480);
  });
});
