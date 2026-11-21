/**
 * Themed pressable button with brand variants, sizes, loading and disabled
 * states, an optional leading icon, and built-in accessibility. Replaces the
 * platform-default React Native `Button` (which renders inconsistent, all-caps
 * controls on Android).
 */
import { Ionicons } from '@expo/vector-icons';
import { type ReactElement, useMemo } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { haptics } from '../../lib/haptics';
import { usePressScale } from '../../lib/usePressScale';
import type { Theme } from '../../theme/ThemeContext';
import { useTheme } from '../../theme/ThemeContext';

/** Visual weight of the button. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
/** Button size. */
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  /** Button label. */
  title: string;
  /** Press handler. */
  onPress: () => void;
  /** Visual variant. Default `primary`. */
  variant?: ButtonVariant;
  /** Size. Default `md`. */
  size?: ButtonSize;
  /** Optional leading Ionicons glyph. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Show a spinner and block presses. */
  loading?: boolean;
  /** Disable the button. */
  disabled?: boolean;
  /** Stretch to the container width. */
  fullWidth?: boolean;
  /** Extra container style. */
  style?: StyleProp<ViewStyle>;
}

/**
 * Resolves the fill, border, and text colors for a variant.
 * @param theme - The active theme.
 * @param variant - The button variant.
 * @returns The background, border, and foreground colors.
 */
function variantColors(
  theme: Theme,
  variant: ButtonVariant,
): { bg: string; border: string; fg: string } {
  const { colors } = theme;
  switch (variant) {
    case 'secondary':
      return { bg: colors.surfaceAlt, border: colors.borderStrong, fg: colors.text };
    case 'ghost':
      return { bg: 'transparent', border: 'transparent', fg: colors.primary };
    case 'danger':
      return { bg: colors.danger, border: colors.danger, fg: colors.onDanger };
    default:
      return { bg: colors.primary, border: colors.primary, fg: colors.onPrimary };
  }
}

const SIZES: Record<
  ButtonSize,
  { padV: number; fontSize: number; iconSize: number; height: number }
> = {
  sm: { padV: 8, fontSize: 14, iconSize: 16, height: 38 },
  md: { padV: 12, fontSize: 15, iconSize: 18, height: 48 },
  lg: { padV: 15, fontSize: 16, iconSize: 20, height: 54 },
};

/**
 * Resolves the palette of an inactive button.
 *
 * A disabled control is not the enabled one at half opacity: that math drops
 * the label below AA. It gets its own neutral fill and a muted label instead.
 * @param theme - The active theme.
 * @param variant - The button variant.
 * @returns The background, border, and foreground colors.
 */
function disabledColors(
  theme: Theme,
  variant: ButtonVariant,
): { bg: string; border: string; fg: string } {
  if (variant === 'ghost') {
    return { bg: 'transparent', border: 'transparent', fg: theme.colors.textMuted };
  }
  return {
    bg: theme.colors.surfaceAlt,
    border: theme.colors.borderStrong,
    fg: theme.colors.textMuted,
  };
}

/** What a button's palette depends on. */
interface ButtonPaletteOptions {
  /** The active theme. */
  readonly theme: Theme;
  /** The button variant. */
  readonly variant: ButtonVariant;
  /** Whether the button is disabled. */
  readonly disabled: boolean;
  /** Whether the button is showing a spinner. */
  readonly loading: boolean;
}

/**
 * Resolves a button's fill, border, and text colors for its current state.
 * @param options - The theme, variant, and disabled/loading flags.
 * @returns The background, border, and foreground colors.
 */
export function resolveButtonColors(options: ButtonPaletteOptions): {
  bg: string;
  border: string;
  fg: string;
} {
  const { theme, variant, disabled, loading } = options;
  if (disabled && !loading) {
    return disabledColors(theme, variant);
  }
  return variantColors(theme, variant);
}

/**
 * Picks a pressed border that stays visible when the fill is unchanged.
 * @param theme - The active theme.
 * @param variant - The button variant.
 * @param pressed - Whether the button is pressed.
 * @returns The pressed border, or undefined to keep the base border.
 */
function pressedBorder(theme: Theme, variant: ButtonVariant, pressed: boolean): string | undefined {
  return pressed && variant === 'secondary' ? theme.colors.textMuted : undefined;
}

/**
 * Picks the pressed fill for variants that can swap colour instead of fading.
 * @param theme - The active theme.
 * @param variant - The button variant.
 * @param pressed - Whether the button is pressed.
 * @returns The pressed fill, or undefined to keep the base fill.
 */
function pressedBackground(
  theme: Theme,
  variant: ButtonVariant,
  pressed: boolean,
): string | undefined {
  if (!pressed) {
    return undefined;
  }
  if (variant === 'primary') {
    return theme.colors.primaryPressed;
  }
  if (variant === 'ghost') {
    return theme.colors.primarySoft;
  }
  return undefined;
}

/**
 * Renders a themed button.
 * @param props - Button configuration.
 * @returns The button element.
 */
export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  fullWidth = true,
  style,
}: Readonly<ButtonProps>): ReactElement {
  const theme = useTheme();
  const dims = SIZES[size];
  const palette = useMemo(
    () => resolveButtonColors({ theme, variant, disabled, loading }),
    [theme, variant, disabled, loading],
  );
  const blocked = disabled || loading;
  const press = usePressScale(0.96);

  const pressIn = (): void => {
    if (blocked) {
      return;
    }
    haptics.selection();
    press.onPressIn();
  };

  return (
    <Animated.View
      style={[
        { transform: [{ scale: press.scale }], alignSelf: fullWidth ? 'stretch' : 'flex-start' },
        style,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: blocked, busy: loading }}
        disabled={blocked}
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={press.onPressOut}
        style={({ pressed }) => [
          styles.base,
          {
            minHeight: Math.max(dims.height, 44),
            minWidth: 44,
            paddingVertical: dims.padV,
            paddingHorizontal: theme.spacing.lg,
            backgroundColor: pressedBackground(theme, variant, pressed) ?? palette.bg,
            borderColor: pressedBorder(theme, variant, pressed) ?? palette.border,
            borderRadius: theme.radius.md,
            opacity: pressed && variant === 'danger' ? 0.9 : 1,
          },
        ]}
      >
        {loading ? (
          <ActivityIndicator color={palette.fg} />
        ) : (
          <View style={styles.content}>
            {icon ? (
              <Ionicons name={icon} size={dims.iconSize} color={palette.fg} accessible={false} />
            ) : null}
            <Text style={[styles.label, { color: palette.fg, fontSize: dims.fontSize }]}>
              {title}
            </Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  content: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontWeight: '600' },
});
