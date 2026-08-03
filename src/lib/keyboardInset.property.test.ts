/**
 * Property-based tests for the keyboard offset arithmetic (OpenSSF Scorecard:
 * Fuzzing).
 *
 * These values come from native layout callbacks, not from us, so the interesting
 * question is not "is 64 + 12 correct" but "can any measurement the platform is
 * capable of emitting produce a style React Native will reject". A single `NaN`
 * padding throws at render time, and a negative one silently inverts the layout.
 */
import * as fc from 'fast-check';

import { computeFocusedFieldOffset, computeStickyFooterOffset } from './keyboardInset';

/** Any double a layout callback could plausibly hand us, including NaN. */
const measurement = fc.oneof(
  fc.double({ noDefaultInfinity: false, noNaN: false }),
  fc.double({ min: 0, max: 2000, noNaN: true }),
);

describe('computeFocusedFieldOffset properties', () => {
  it('always returns a finite, non-negative offset', () => {
    fc.assert(
      fc.property(measurement, measurement, (footerHeight, extraGap) => {
        const result = computeFocusedFieldOffset({ footerHeight, extraGap });
        expect(Number.isFinite(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('never reserves less than the requested gap for a sane gap', () => {
    fc.assert(
      fc.property(
        measurement,
        fc.double({ min: 0, max: 200, noNaN: true }),
        (footerHeight, extraGap) => {
          expect(computeFocusedFieldOffset({ footerHeight, extraGap })).toBeGreaterThanOrEqual(
            extraGap,
          );
        },
      ),
    );
  });
});

describe('computeStickyFooterOffset properties', () => {
  it('always returns a finite, non-negative offset', () => {
    fc.assert(
      fc.property(measurement, (inset) => {
        const result = computeStickyFooterOffset(inset);
        expect(Number.isFinite(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('never over-corrects beyond the reported inset', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 200, noNaN: true }), (inset) => {
        expect(computeStickyFooterOffset(inset)).toBeLessThanOrEqual(inset);
      }),
    );
  });
});
