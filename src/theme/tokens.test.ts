import { resolveBannerToneStyle } from '../components/ui/Banner';
import { resolvePillToneStyle } from '../components/ui/StatusPill';
import type { Theme } from './ThemeContext';
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
