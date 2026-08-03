/**
 * Keyboard offset arithmetic, kept pure and separate from the components that
 * apply it.
 *
 * Three numbers matter, and each is easy to get subtly wrong.
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
 * The third is the height budget of a panel that is itself lifted by the
 * keyboard. Capping such a panel against the full window is what pushes its
 * top, and its title, off the top of the screen once the keyboard opens.
 *
 * All three are arithmetic, so they live here where they can be unit- and
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

/** Geometry needed to size a panel that the keyboard lifts off the bottom edge. */
export interface SheetMaxHeightInputs {
  /** Height of the window the panel is displayed in. */
  readonly windowHeight: number;
  /** Current keyboard height, or zero while it is closed. */
  readonly keyboardHeight: number;
  /** Fraction of the free space the panel may occupy, in (0, 1]. */
  readonly ratio: number;
}

/**
 * Clamps a share of available space to a usable fraction.
 * @param value - Raw ratio.
 * @returns The ratio when it is a fraction above zero, otherwise one.
 */
function clampRatio(value: number): number {
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : 1;
}

/**
 * Computes the tallest a keyboard-lifted panel may be and stay fully on screen.
 *
 * A panel pinned to the bottom edge and translated up by the keyboard height
 * only has the space *above* the keyboard to grow into. Budgeting it against
 * the whole window instead is what silently moves its top edge off screen: an
 * 80%-tall panel lifted by a 40%-tall keyboard starts 20% above the top.
 *
 * A keyboard reported as at least as tall as the window is treated as
 * unmeasured rather than collapsing the panel to nothing, since a panel with no
 * height is a worse failure than one that is slightly too tall.
 * @param inputs - Window and keyboard heights plus the share to allow.
 * @returns A non-negative maximum height in density-independent pixels.
 */
export function computeSheetMaxHeight(inputs: Readonly<SheetMaxHeightInputs>): number {
  const windowHeight = clampMeasurement(inputs.windowHeight);
  const keyboardHeight = clampMeasurement(inputs.keyboardHeight);
  const available = keyboardHeight < windowHeight ? windowHeight - keyboardHeight : windowHeight;
  return clampMeasurement(available * clampRatio(inputs.ratio));
}
