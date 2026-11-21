import { contrastRatio } from '../../theme/contrast';
import type { Theme } from '../../theme/ThemeContext';
import { darkColors, lightColors, radius, spacing, typography } from '../../theme/tokens';
import { type ButtonVariant, resolveButtonColors } from './Button';

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

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger'];

describe('resolveButtonColors', () => {
  it.each([lightTheme, darkTheme])('keeps disabled labels at AA (%#)', (theme) => {
    for (const variant of VARIANTS) {
      const palette = resolveButtonColors({ theme, variant, disabled: true, loading: false });
      const fill = palette.bg === 'transparent' ? theme.colors.surface : palette.bg;

      expect(contrastRatio(palette.fg, fill)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each([lightTheme, darkTheme])('keeps a disabled boundary at 3:1 (%#)', (theme) => {
    for (const variant of ['primary', 'secondary', 'danger'] as const) {
      const palette = resolveButtonColors({ theme, variant, disabled: true, loading: false });

      expect(contrastRatio(palette.border, palette.bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(palette.border, theme.colors.bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(palette.border, theme.colors.surface)).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps the brand palette while a disabled button is loading', () => {
    const palette = resolveButtonColors({
      theme: lightTheme,
      variant: 'primary',
      disabled: true,
      loading: true,
    });

    expect(palette).toEqual({
      bg: lightColors.primary,
      border: lightColors.primary,
      fg: lightColors.onPrimary,
    });
  });
});
