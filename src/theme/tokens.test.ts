import { resolveBannerToneStyle } from '../components/ui/Banner';
import { resolvePillToneStyle } from '../components/ui/StatusPill';
import { contrastRatio } from './contrast';
import type { Theme } from './ThemeContext';
import type { ThemeColors } from './tokens';
import { darkColors, lightColors, radius, spacing, typography } from './tokens';

const lightTheme: Theme = {
  colors: lightColors,
  spacing,
  radius,
  typography,
  scheme: 'light',
  shadow: () => ({}),
};

const darkTheme: Theme = {
  ...lightTheme,
  colors: darkColors,
  scheme: 'dark',
};

/**
 * Pairs that carry text or a meaningful icon. Each must clear WCAG 2.1 AA:
 * 4.5:1 for normal text, which also covers the 3:1 non-text minimum.
 */
const TEXT_PAIRS = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['textMuted', 'bg'],
  ['textMuted', 'surface'],
  ['textSubtle', 'bg'],
  ['textSubtle', 'surface'],
  ['textSubtle', 'surfaceAlt'],
  ['onPrimary', 'primary'],
  ['onPrimary', 'primaryPressed'],
  ['primary', 'bg'],
  ['primary', 'surface'],
  ['primary', 'primarySoft'],
  ['success', 'successSoft'],
  ['warning', 'warningSoft'],
  ['danger', 'dangerSoft'],
  ['onDanger', 'danger'],
] as const satisfies readonly (readonly [keyof ThemeColors, keyof ThemeColors])[];

describe.each([
  ['light', lightColors],
  ['dark', darkColors],
] as const)('%s palette contrast', (_scheme, colors) => {
  it.each(TEXT_PAIRS)('%s on %s meets WCAG AA for text', (foreground, background) => {
    expect(contrastRatio(colors[foreground], colors[background])).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps input boundaries visible at 3:1', () => {
    expect(contrastRatio(colors.borderStrong, colors.surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(colors.borderStrong, colors.surfaceAlt)).toBeGreaterThanOrEqual(3);
  });
});

describe('warning tone colors', () => {
  it('defines distinct soft warning tokens for light and dark themes', () => {
    expect(lightColors.warningSoft).toBeDefined();
    expect(lightColors.warningSoft).not.toBe(lightColors.dangerSoft);
    expect(darkColors.warningSoft).toBeDefined();
    expect(darkColors.warningSoft).not.toBe(darkColors.dangerSoft);
  });

  it('uses warningSoft for warning banners and status pills', () => {
    expect(resolveBannerToneStyle(lightTheme, 'warning').bg).toBe(lightColors.warningSoft);
    expect(resolvePillToneStyle(darkTheme, 'warning').bg).toBe(darkColors.warningSoft);
  });
});
