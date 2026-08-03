/**
 * Keyboard offset arithmetic, kept pure and separate from the components that
 * apply it.
 *
 * Two numbers matter, and both are easy to get subtly wrong.
 *
 * The first is the safe-area correction. On a gesture-navigation device the
 * reported keyboard height already spans the home-indicator strip, so a layout
 * that lifts by both the keyboard height and `insets.bottom` overshoots by
 * roughly 20-35 dp and leaves a visible band of background under the keyboard.
 *
 * The second is the sticky bottom cluster. Once a save bar is lifted above the
 * keyboard it covers the bottom of the scroll viewport, so a field scrolled to
 * sit just above the keyboard can still end up behind the bar.
 *
 * Both are arithmetic, so they live here where they can be unit- and
 * property-tested rather than eyeballed on a device.
 */

/** Geometry needed to keep a focused field clear of the sticky bottom cluster. */
export interface FocusedFieldOffsetInputs {
  /** Measured height of the sticky cluster lifted above the keyboard. */
  readonly footerHeight: number;
  /** Breathing room between the focused field and whatever sits below it. */
  readonly extraGap: number;
}

/**
 * Clamps a possibly hostile measurement to a usable, non-negative number.
 *
 * Layout measurements arrive from native and can be `NaN` mid-transition or
 * `Infinity` on an unmeasured node; either would poison every downstream style.
 * @param value - Raw measured value.
 * @returns The value when finite and positive, otherwise zero.
 */
function clampMeasurement(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Computes how far above the keyboard a focused field must be parked.
 *
 * The keyboard height is deliberately absent: the keyboard-aware container adds
 * that itself, and this is the extra distance on top of it.
 *
 * The sum is clamped as well as its terms. Two individually finite doubles can
 * still add up to `Infinity`, and an offset is the one place in this module
 * where two measurements are combined.
 * @param inputs - Measured sticky-cluster height and the desired gap.
 * @returns A non-negative offset in density-independent pixels.
 */
export function computeFocusedFieldOffset(inputs: Readonly<FocusedFieldOffsetInputs>): number {
  const footerHeight = clampMeasurement(inputs.footerHeight);
  const extraGap = clampMeasurement(inputs.extraGap);
  return clampMeasurement(footerHeight + extraGap);
}

/**
 * Computes the `translateY` correction for a view stuck to the keyboard.
 *
 * A sticky view is translated by the raw keyboard height, which already spans
 * the bottom safe area the view was padded for; without this correction the
 * view floats that far above the keyboard.
 * @param bottomSafeAreaInset - Bottom safe-area inset in dp.
 * @returns A non-negative correction in density-independent pixels.
 */
export function computeStickyFooterOffset(bottomSafeAreaInset: number): number {
  return clampMeasurement(bottomSafeAreaInset);
}
