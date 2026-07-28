/**
 * Compact status pill: a tinted rounded badge with an optional icon and a
 * label. Conveys state with color and text/icon (never color alone).
 */
import { Ionicons } from '@expo/vector-icons';
import { Animated, StyleSheet, Text } from 'react-native';

import { useMountPop } from '../../lib/useMountPop';
import { useTheme } from '../../theme/ThemeContext';
import type { Theme } from '../../theme/ThemeContext';

/** Semantic tone of the pill. */
export type PillTone = 'success' | 'danger' | 'warning' | 'neutral';

interface StatusPillProps {
  /** Pill label. */
  label: string;
  /** Tone. Default `neutral`. */
  tone?: PillTone;
  /** Optional leading icon (defaults per tone). */
  icon?: keyof typeof Ionicons.glyphMap;
}

/**
 * Resolves a pill tone to semantic foreground, background, and icon.
 * @param theme - The active theme.
 * @param tone - The pill tone.
 * @returns Foreground, background, and default icon.
 */
export function resolvePillToneStyle(
  theme: Theme,
  tone: PillTone,
): { fg: string; bg: string; icon: keyof typeof Ionicons.glyphMap } {
  const { colors } = theme;
  switch (tone) {
    case 'success':
      return { fg: colors.success, bg: colors.successSoft, icon: 'checkmark-circle' };
    case 'danger':
      return { fg: colors.danger, bg: colors.dangerSoft, icon: 'close-circle' };
    case 'warning':
      return { fg: colors.warning, bg: colors.warningSoft, icon: 'alert-circle' };
    default:
      return { fg: colors.textMuted, bg: colors.surfaceAlt, icon: 'ellipse' };
  }
}

/**
 * Renders a status pill.
 * @param props - Pill configuration.
 * @returns The pill element.
 */
export function StatusPill({ label, tone = 'neutral', icon }: StatusPillProps) {
  const theme = useTheme();
  const pop = useMountPop();
  const style = resolvePillToneStyle(theme, tone);
  return (
    <Animated.View
      style={[
        styles.pill,
        {
          backgroundColor: style.bg,
          borderRadius: theme.radius.pill,
          opacity: pop.opacity,
          transform: [{ scale: pop.scale }],
        },
      ]}
    >
      <Ionicons name={icon ?? style.icon} size={13} color={style.fg} />
      <Text style={[styles.label, { color: style.fg }]}>{label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start',
  },
  label: { fontSize: 12, fontWeight: '600' },
});
