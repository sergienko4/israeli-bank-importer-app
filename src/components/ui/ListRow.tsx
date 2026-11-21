/**
 * Tappable list row with a leading icon bubble, a title, an optional subtitle,
 * and a trailing slot (defaults to a chevron when the row is pressable).
 */
import { Ionicons } from '@expo/vector-icons';
import type { ReactElement, ReactNode } from 'react';
import type { AccessibilityRole, AccessibilityState } from 'react-native';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { haptics } from '../../lib/haptics';
import { usePressScale } from '../../lib/usePressScale';
import type { Theme } from '../../theme/ThemeContext';
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
  /** Content after the pressable area, so a control can own its own tap target. */
  trailing?: ReactNode;
  /** Tint the row for destructive intent. */
  danger?: boolean;
  /** Accessible state for selectable rows. */
  accessibilityState?: AccessibilityState;
  /** Accessible role for pressable rows. Defaults to `button`. */
  accessibilityRole?: AccessibilityRole;
  /** Additional hint announced by screen readers. */
  accessibilityHint?: string;
}

interface RowIconProps {
  icon?: keyof typeof Ionicons.glyphMap;
  emoji?: string;
  bubbleBg: string;
  radius: number;
  tint: string;
}

interface RowTextsProps {
  title: string;
  subtitle?: string;
  danger: boolean;
}

interface RowTrailingProps {
  right?: ReactNode;
  onPress?: () => void;
  color: string;
}

function RowIcon({
  icon,
  emoji,
  bubbleBg,
  radius,
  tint,
}: Readonly<RowIconProps>): ReactElement | null {
  if (!icon && !emoji) {
    return null;
  }

  return (
    <View style={[styles.bubble, { backgroundColor: bubbleBg, borderRadius: radius }]}>
      {emoji ? <Text style={styles.emoji}>{emoji}</Text> : null}
      {!emoji && icon ? <Ionicons name={icon} size={20} color={tint} accessible={false} /> : null}
    </View>
  );
}

function RowTexts({ title, subtitle, danger }: Readonly<RowTextsProps>): ReactElement {
  const theme = useTheme();
  const titleColor = danger ? theme.colors.danger : theme.colors.text;

  return (
    <View style={styles.texts}>
      <Text style={[theme.typography.h3, { color: titleColor }]}>{title}</Text>
      {subtitle ? (
        <Text style={[theme.typography.small, { color: theme.colors.textMuted }]} numberOfLines={2}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

function RowTrailing({ right, onPress, color }: Readonly<RowTrailingProps>): ReactElement | null {
  if (right !== undefined && right !== null) {
    return <>{right}</>;
  }

  if (onPress) {
    return <Ionicons name="chevron-forward" size={20} color={color} accessible={false} />;
  }

  return null;
}

/**
 * Resolves the row's icon tint and bubble fill.
 * @param theme - The active theme.
 * @param danger - Whether the row is destructive.
 * @returns The tint and bubble colours.
 */
function rowTone(theme: Theme, danger: boolean): { tint: string; bubbleBg: string } {
  return danger
    ? { tint: theme.colors.danger, bubbleBg: theme.colors.dangerSoft }
    : { tint: theme.colors.primary, bubbleBg: theme.colors.primarySoft };
}

/**
 * Builds the row's accessible name.
 * @param title - The primary text.
 * @param subtitle - Optional secondary text.
 * @returns The combined name.
 */
function rowName(title: string, subtitle?: string): string {
  return subtitle ? `${title}, ${subtitle}` : title;
}

/**
 * Reports whether a slot has content.
 * @param value - The slot value.
 * @returns True when it is neither undefined nor null.
 */
function hasContent(value: ReactNode): boolean {
  return value !== undefined && value !== null && value !== false && value !== '';
}

/**
 * Builds the pressable row's padding.
 * @param theme - The active theme.
 * @param hasTrailing - Whether a trailing control follows.
 * @returns The padding style.
 */
function rowPadding(
  theme: Theme,
  hasTrailing: boolean,
): { paddingVertical: number; paddingLeft: number; paddingRight: number } {
  return {
    paddingVertical: theme.spacing.md,
    paddingLeft: theme.spacing.lg,
    paddingRight: hasTrailing ? theme.spacing.sm : theme.spacing.lg,
  };
}

/**
 * Renders a themed list row.
 * @param props - Row configuration.
 * @returns The row element.
 */
export function ListRow({
  title,
  subtitle,
  icon,
  emoji,
  onPress,
  right,
  trailing,
  danger = false,
  accessibilityState,
  accessibilityRole = 'button',
  accessibilityHint,
}: Readonly<ListRowProps>): ReactElement {
  const theme = useTheme();
  const press = usePressScale(0.98);
  const { tint, bubbleBg } = rowTone(theme, danger);
  const accessibleName = rowName(title, subtitle);
  const hasTrailing = hasContent(trailing);

  const content = (
    <>
      <RowIcon icon={icon} emoji={emoji} bubbleBg={bubbleBg} radius={theme.radius.md} tint={tint} />
      <RowTexts title={title} subtitle={subtitle} danger={danger} />
      <RowTrailing right={right} onPress={onPress} color={theme.colors.textSubtle} />
    </>
  );

  const rowStyle = {
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    backgroundColor: theme.colors.surface,
  };

  if (!onPress) {
    return (
      <View style={[styles.row, rowStyle]}>
        {content}
        {trailing}
      </View>
    );
  }

  const pressIn = (): void => {
    haptics.light();
    press.onPressIn();
  };

  const pressablePadding = rowPadding(theme, hasTrailing);

  return (
    <Animated.View
      style={[
        styles.shell,
        { backgroundColor: theme.colors.surface, transform: [{ scale: press.scale }] },
      ]}
    >
      <Pressable
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibleName}
        accessibilityHint={accessibilityHint}
        accessibilityState={accessibilityState}
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={press.onPressOut}
        style={({ pressed }) => [
          styles.pressable,
          pressablePadding,
          { backgroundColor: pressed ? theme.colors.surfaceAlt : theme.colors.surface },
        ]}
      >
        {content}
      </Pressable>
      {hasTrailing ? <View style={{ paddingRight: theme.spacing.lg }}>{trailing}</View> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  shell: { flexDirection: 'row', alignItems: 'center' },
  pressable: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  bubble: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 20 },
  texts: { flex: 1 },
});
