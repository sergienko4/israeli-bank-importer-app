/**
 * WCAG 2.1 contrast arithmetic for the theme tokens.
 *
 * Kept as pure functions so the palette is held to a number in tests rather
 * than to an opinion in review. Only the `#RRGGBB` form used by the tokens is
 * accepted; anything else throws so an `rgba()` scrim cannot slip through
 * unchecked.
 */

const HEX = /^#([\da-f]{6})$/i;

/**
 * Reads one colour channel as a 0-1 value.
 * @param hex - The six hex digits, without `#`.
 * @param offset - The channel's character offset.
 * @returns The channel in the 0-1 range.
 */
function channel(hex: string, offset: number): number {
  return Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
}

/**
 * Converts a channel to linear light, as WCAG defines it.
 * @param value - The channel in the 0-1 range.
 * @returns The linear-light value.
 */
function linear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/**
 * Computes a colour's relative luminance.
 * @param color - A `#RRGGBB` colour.
 * @returns The relative luminance in the 0-1 range.
 */
export function relativeLuminance(color: string): number {
  const match = HEX.exec(color);
  if (match === null) {
    throw new Error(`Expected a #RRGGBB colour, received "${color}"`);
  }
  const hex = match[1];
  const red = linear(channel(hex, 0));
  const green = linear(channel(hex, 2));
  const blue = linear(channel(hex, 4));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/**
 * Computes the contrast ratio between two colours.
 * @param foreground - A `#RRGGBB` colour.
 * @param background - A `#RRGGBB` colour.
 * @returns The ratio from 1 (identical) to 21 (black on white).
 */
export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}
