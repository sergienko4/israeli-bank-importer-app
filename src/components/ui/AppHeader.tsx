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
  /** Optional right-aligned content (e.g. an action). */
  right?: ReactNode;
}

/**
 * Renders the screen header.
 * @param props - Header configuration.
 * @returns The header element.
 */
export function AppHeader({ title, subtitle, onBack, right }: AppHeaderProps): ReactElement {
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
          onPress={onBack}
          hitSlop={8}
          style={({ pressed }) => [
            styles.back,
            { backgroundColor: theme.colors.surfaceAlt, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </Pressable>
      ) : null}
      <View style={styles.titles}>
        <Text style={[theme.typography.h2, { color: theme.colors.text }]} numberOfLines={1}>
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
  back: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  titles: { flex: 1 },
});
