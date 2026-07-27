/**
 * Elevated surface container. Groups related content with the theme's radius,
 * hairline border, padding, and a subtle (light-mode) shadow. When given an
 * `onPress` it becomes a pressable card with the shared press micro-interaction.
 */
import type { ReactNode } from 'react';
import { Animated, Pressable, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { haptics } from '../../lib/haptics';
import { usePressScale } from '../../lib/usePressScale';
import { useTheme } from '../../theme/ThemeContext';
import type { Elevation } from '../../theme/ThemeContext';

interface CardProps {
  /** Card content. */
  children: ReactNode;
  /** Apply internal padding. Default true. */
  padded?: boolean;
  /** Shadow level. Default 1. */
  elevation?: Elevation;
  /** Makes the card pressable with a press micro-interaction. */
  onPress?: () => void;
  /** Extra style. */
  style?: StyleProp<ViewStyle>;
}

/**
 * Renders a themed surface card, pressable when `onPress` is provided.
 * @param props - Card configuration.
 * @returns The card element.
 */
export function Card({
  children, padded = true, elevation = 1, onPress, style,
}: CardProps) {
  const theme = useTheme();
  const press = usePressScale();
  const cardStyle: StyleProp<ViewStyle> = [
    {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: padded ? theme.spacing.lg : 0,
    },
    theme.shadow(elevation),
    style,
  ];

  if (!onPress) {
    return <View style={cardStyle}>{children}</View>;
  }

  const pressIn = (): void => {
    haptics.light();
    press.onPressIn();
  };
  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={press.onPressOut}
        style={({ pressed }) => [cardStyle, { opacity: pressed ? 0.92 : 1 }]}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
