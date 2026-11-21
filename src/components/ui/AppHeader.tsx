/**
 * Screen header: an optional back button, a title with optional subtitle, and
 * an optional right-hand slot, separated from the body by a hairline.
 */
import { Ionicons } from '@expo/vector-icons';
import type { ReactElement, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Theme } from '../../theme/ThemeContext';
import { useTheme } from '../../theme/ThemeContext';

interface AppHeaderProps {
  /** Header title. */
  title: string;
  /** Optional secondary line under the title. */
  subtitle?: string;
  /** When provided, renders a back button that calls this. */
  onBack?: () => void;
  /** Disables the back button while an action owns the screen. */
  backDisabled?: boolean;
  /** Optional right-aligned content (e.g. an action). */
  right?: ReactNode;
}

/**
 * Resolves the back button's fill and icon colours.
 *
 * A disabled button is not the enabled one at 40% opacity: that composites the
 * icon below 3:1. It gets a muted icon and its normal fill instead.
 * @param theme - The active theme.
 * @param disabled - Whether the button is disabled.
 * @param pressed - Whether the button is pressed.
 * @returns The fill and icon colours.
 */
function backColors(theme: Theme, disabled: boolean, pressed: boolean): { bg: string; fg: string } {
  if (disabled) {
    return { bg: theme.colors.surfaceAlt, fg: theme.colors.textMuted };
  }
  if (pressed) {
    return { bg: theme.colors.primarySoft, fg: theme.colors.primary };
  }
  return { bg: theme.colors.surfaceAlt, fg: theme.colors.text };
}

/**
 * Renders the screen header.
 * @param props - Header configuration.
 * @returns The header element.
 */
export function AppHeader({
  title,
  subtitle,
  onBack,
  backDisabled = false,
  right,
}: Readonly<AppHeaderProps>): ReactElement {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.root,
        {
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.md,
          borderBottomColor: theme.colors.border,
          backgroundColor: theme.colors.bg,
        },
      ]}
    >
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          accessibilityState={{ disabled: backDisabled }}
          disabled={backDisabled}
          onPress={onBack}
          hitSlop={8}
          style={({ pressed }) => {
            const colors = backColors(theme, backDisabled, pressed);
            return [
              styles.back,
              {
                backgroundColor: colors.bg,
                borderRadius: theme.radius.sm,
              },
            ];
          }}
        >
          {({ pressed }) => (
            <Ionicons
              name="chevron-back"
              size={22}
              color={backColors(theme, backDisabled, pressed).fg}
              accessible={false}
            />
          )}
        </Pressable>
      ) : null}
      <View style={styles.titles}>
        <Text
          accessibilityRole="header"
          style={[theme.typography.h2, { color: theme.colors.text }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={[theme.typography.small, { color: theme.colors.textMuted }]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  titles: { flex: 1 },
});
