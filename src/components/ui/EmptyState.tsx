/**
 * Friendly empty state: a centered icon bubble, a title, an optional message,
 * and an optional call-to-action button. Used instead of blank screens.
 */
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../../theme/ThemeContext';
import { Button } from './Button';

interface EmptyStateProps {
  /** Illustrative Ionicons glyph. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Headline. */
  title: string;
  /** Supporting message. */
  message?: string;
  /** CTA label; renders a button when paired with `onAction`. */
  actionLabel?: string;
  /** CTA handler. */
  onAction?: () => void;
}

/**
 * Renders a centered empty state.
 * @param props - Empty-state configuration.
 * @returns The empty-state element.
 */
export function EmptyState({
  icon = 'file-tray-outline', title, message, actionLabel, onAction,
}: EmptyStateProps) {
  const theme = useTheme();
  return (
    <View style={styles.root} accessibilityRole="summary">
      <View style={[styles.bubble, { backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.pill }]}>
        <Ionicons name={icon} size={30} color={theme.colors.primary} />
      </View>
      <Text style={[theme.typography.h3, styles.title, { color: theme.colors.text }]}>{title}</Text>
      {message ? (
        <Text style={[theme.typography.body, styles.message, { color: theme.colors.textMuted }]}>{message}</Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={styles.action}>
          <Button title={actionLabel} onPress={onAction} fullWidth={false} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, gap: 8 },
  bubble: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  title: { textAlign: 'center' },
  message: { textAlign: 'center', maxWidth: 280 },
  action: { marginTop: 12 },
});
