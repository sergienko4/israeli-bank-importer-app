/**
 * Tappable list row with a leading icon bubble, a title, an optional subtitle,
 * and a trailing slot (defaults to a chevron when the row is pressable).
 */
import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import {
  Animated, Pressable, StyleSheet, Text, View,
} from 'react-native';
import type { AccessibilityRole, AccessibilityState } from 'react-native';

import { haptics } from '../../lib/haptics';
import { usePressScale } from '../../lib/usePressScale';
import { useTheme } from '../../theme/ThemeContext';

interface ListRowProps {
  /** Primary text. */
  title: string;
  /** Secondary text under the title. */
  subtitle?: string;
  /** Leading Ionicons glyph. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Emoji used instead of an icon (e.g. a manifest-provided glyph). */
  emoji?: string;
  /** Press handler; a chevron is shown when set unless `right` is provided. */
  onPress?: () => void;
  /** Trailing content (overrides the default chevron). */
  right?: ReactNode;
  /** Tint the row for destructive intent. */
  danger?: boolean;
  /** Accessible state for selectable rows. */
  accessibilityState?: AccessibilityState;
  /** Accessible role for pressable rows. Defaults to `button`. */
  accessibilityRole?: AccessibilityRole;
  /** Additional hint announced by screen readers. */
  accessibilityHint?: string;
}

/**
 * Renders a themed list row.
 * @param props - Row configuration.
 * @returns The row element.
 */
export function ListRow({
  title, subtitle, icon, emoji, onPress, right, danger = false,
  accessibilityState, accessibilityRole = 'button', accessibilityHint,
}: ListRowProps) {
  const theme = useTheme();
  const press = usePressScale(0.98);
  const tint = danger ? theme.colors.danger : theme.colors.primary;
  const bubbleBg = danger ? theme.colors.dangerSoft : theme.colors.primarySoft;
  const accessibleName = subtitle ? `${title}, ${subtitle}` : title;

  const content = (
    <>
      {icon || emoji ? (
        <View style={[styles.bubble, { backgroundColor: bubbleBg, borderRadius: theme.radius.md }]}>
          {emoji ? (
            <Text style={styles.emoji}>{emoji}</Text>
          ) : icon ? (
            <Ionicons name={icon} size={20} color={tint} />
          ) : null}
        </View>
      ) : null}
      <View style={styles.texts}>
        <Text style={[theme.typography.h3, { color: danger ? theme.colors.danger : theme.colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[theme.typography.small, { color: theme.colors.textMuted }]} numberOfLines={2}>{subtitle}</Text>
        ) : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={20} color={theme.colors.textSubtle} /> : null)}
    </>
  );

  const rowStyle = {
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    backgroundColor: theme.colors.surface,
  };

  if (!onPress) {
    return <View style={[styles.row, rowStyle]}>{content}</View>;
  }

  const pressIn = (): void => {
    haptics.light();
    press.onPressIn();
  };

  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibleName}
        accessibilityHint={accessibilityHint}
        accessibilityState={accessibilityState}
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={press.onPressOut}
        style={({ pressed }) => [styles.row, rowStyle, { opacity: pressed ? 0.85 : 1 }]}
      >
        {content}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bubble: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 20 },
  texts: { flex: 1 },
});
