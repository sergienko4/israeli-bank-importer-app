/**
 * Elevated surface container. Groups related content with the theme's radius,
 * hairline border, padding, and a subtle (light-mode) shadow.
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { useTheme } from '../../theme/ThemeContext';
import type { Elevation } from '../../theme/ThemeContext';

interface CardProps {
  /** Card content. */
  children: ReactNode;
  /** Apply internal padding. Default true. */
  padded?: boolean;
  /** Shadow level. Default 1. */
  elevation?: Elevation;
  /** Extra style. */
  style?: StyleProp<ViewStyle>;
}

/**
 * Renders a themed surface card.
 * @param props - Card configuration.
 * @returns The card element.
 */
export function Card({
  children, padded = true, elevation = 1, style,
}: CardProps) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.colors.border,
          padding: padded ? theme.spacing.lg : 0,
        },
        theme.shadow(elevation),
        style,
      ]}
    >
      {children}
    </View>
  );
}
