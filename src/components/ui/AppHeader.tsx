/**
 * Screen header: an optional back button, a title with optional subtitle, and
 * an optional right-hand slot, separated from the body by a hairline.
 */
import { Ionicons } from '@expo/vector-icons';
import type { ReactElement, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
 * Resolves the back button's opacity.
 * @param disabled - Whether the button is disabled.
 * @param pressed - Whether the button is pressed.
 * @returns The opacity to render.
 */
function resolveBackOpacity(disabled: boolean, pressed: boolean): number {
  if (disabled) {
    return 0.4;
  }
  return pressed ? 0.7 : 1;
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
          style={({ pressed }) => [
            styles.back,
            {
              backgroundColor: theme.colors.surfaceAlt,
              borderRadius: theme.radius.sm,
              opacity: resolveBackOpacity(backDisabled, pressed),
            },
          ]}
        >
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} accessible={false} />
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
