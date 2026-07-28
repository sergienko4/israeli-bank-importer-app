/**
 * Elevated surface container. Groups related content with the theme's radius,
 * hairline border, padding, and a subtle (light-mode) shadow. When given an
 * `onPress` it becomes a pressable card with the shared press micro-interaction.
 */
import type { ReactElement, ReactNode } from 'react';
import type { AccessibilityRole, StyleProp, ViewStyle } from 'react-native';
import { Animated, Pressable, View } from 'react-native';

import { haptics } from '../../lib/haptics';
import { usePressScale } from '../../lib/usePressScale';
import type { Elevation } from '../../theme/ThemeContext';
import { useTheme } from '../../theme/ThemeContext';

interface CardProps {
  /** Card content. */
  children: ReactNode;
  /** Apply internal padding. Default true. */
  padded?: boolean;
  /** Shadow level. Default 1. */
  elevation?: Elevation;
  /** Makes the card pressable with a press micro-interaction. */
  onPress?: () => void;
  /** Accessible name for pressable cards. */
  accessibilityLabel?: string;
  /** Optional accessibility hint for pressable cards. */
  accessibilityHint?: string;
  /** Pressable role. Defaults to `button`. */
  accessibilityRole?: AccessibilityRole;
  /** Extra style. */
  style?: StyleProp<ViewStyle>;
}

/**
 * Renders a themed surface card, pressable when `onPress` is provided.
 * @param props - Card configuration.
 * @returns The card element.
 */
export function Card({
  children,
  padded = true,
  elevation = 1,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = 'button',
  style,
}: CardProps): ReactElement {
  const theme = useTheme();
  const press = usePressScale();
  const cardStyle: StyleProp<ViewStyle> = [
    {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      minHeight: onPress ? 44 : undefined,
      minWidth: onPress ? 44 : undefined,
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
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
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
