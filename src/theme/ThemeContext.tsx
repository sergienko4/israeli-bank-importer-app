/**
 * Theme context: resolves the active palette from the OS color scheme and
 * exposes it with the static scales via {@link useTheme}. Wrap the app in
 * {@link ThemeProvider} once; every screen and primitive reads from the hook.
 */
import type { ReactElement, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';
import type { ViewStyle } from 'react-native';
import { useColorScheme } from 'react-native';

import type { Radius, Spacing, ThemeColors, Typography } from './tokens';
import { darkColors, lightColors, radius, spacing, typography } from './tokens';

/** Elevation levels for {@link Theme.shadow}. */
export type Elevation = 0 | 1 | 2 | 3;

/** The full theme handed to consumers. */
export interface Theme {
  /** Active palette (light or dark). */
  colors: ThemeColors;
  /** Spacing scale. */
  spacing: Spacing;
  /** Radius scale. */
  radius: Radius;
  /** Typography scale. */
  typography: Typography;
  /** Active scheme name. */
  scheme: 'light' | 'dark';
  /** Builds a soft, scheme-aware elevation shadow at the given level. */
  shadow: (elevation: Elevation) => ViewStyle;
}

/**
 * Builds a subtle elevation shadow appropriate to the scheme. Dark mode leans
 * on borders rather than shadows, so shadows there are near-invisible.
 * @param scheme - The active color scheme.
 * @returns A shadow factory keyed by elevation level.
 */
function makeShadow(scheme: 'light' | 'dark'): (elevation: Elevation) => ViewStyle {
  return (elevation: Elevation): ViewStyle => {
    if (elevation === 0 || scheme === 'dark') {
      return {};
    }
    const depth = { 1: 2, 2: 6, 3: 12 }[elevation];
    return {
      shadowColor: '#0F1F18',
      shadowOffset: { width: 0, height: depth / 2 },
      shadowOpacity: 0.08 + elevation * 0.02,
      shadowRadius: depth,
      elevation,
    };
  };
}

const ThemeContext = createContext<Theme | null>(null);

/**
 * Provides the resolved theme to the tree, reacting to OS light/dark changes.
 * @param props - The subtree to theme.
 * @returns The provider element.
 */
export function ThemeProvider({ children }: { children: ReactNode }): ReactElement {
  const system = useColorScheme();
  const scheme: 'light' | 'dark' = system === 'dark' ? 'dark' : 'light';
  const value = useMemo<Theme>(
    () => ({
      colors: scheme === 'dark' ? darkColors : lightColors,
      spacing,
      radius,
      typography,
      scheme,
      shadow: makeShadow(scheme),
    }),
    [scheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Reads the active theme. Must be used within a {@link ThemeProvider}.
 * @returns The resolved theme.
 * @throws Error when used outside a {@link ThemeProvider}.
 */
export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return theme;
}
