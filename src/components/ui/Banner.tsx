/**
 * Inline banner for validation errors, warnings, or success notices. Conveys
 * tone with a tinted background and an icon alongside one or more messages.
 */
import { Ionicons } from '@expo/vector-icons';
import type { ReactElement } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { useMountPop } from '../../lib/useMountPop';
import type { Theme } from '../../theme/ThemeContext';
import { useTheme } from '../../theme/ThemeContext';

/** Banner tone. */
export type BannerTone = 'danger' | 'success' | 'warning' | 'info';

interface BannerProps {
  /** One or more lines to display. */
  messages: string[];
  /** Tone. Default `danger`. */
  tone?: BannerTone;
}

/**
 * Resolves the banner tone to semantic foreground, background, and icon.
 * @param theme - The active theme.
 * @param tone - The banner tone.
 * @returns Foreground, background, and icon.
 */
export function resolveBannerToneStyle(
  theme: Theme,
  tone: BannerTone,
): { fg: string; bg: string; icon: keyof typeof Ionicons.glyphMap } {
  const { colors } = theme;
  switch (tone) {
    case 'success':
      return { fg: colors.success, bg: colors.successSoft, icon: 'checkmark-circle' };
    case 'warning':
      return { fg: colors.warning, bg: colors.warningSoft, icon: 'alert-circle' };
    case 'info':
      return { fg: colors.primary, bg: colors.primarySoft, icon: 'information-circle' };
    default:
      return { fg: colors.danger, bg: colors.dangerSoft, icon: 'alert-circle' };
  }
}

/**
 * Renders an inline banner.
 * @param props - Banner configuration.
 * @returns The banner element, or null when there are no messages.
 */
export function Banner({ messages, tone = 'danger' }: BannerProps): ReactElement | null {
  const theme = useTheme();
  const pop = useMountPop();
  if (messages.length === 0) {
    return null;
  }

  const style = resolveBannerToneStyle(theme, tone);
  const shouldAnnounce = tone === 'danger' || tone === 'warning';
  const translateY = pop.opacity.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] });
  return (
    <Animated.View
      accessibilityRole={shouldAnnounce ? 'alert' : undefined}
      accessibilityLiveRegion={shouldAnnounce ? 'polite' : undefined}
      style={[
        styles.root,
        {
          backgroundColor: style.bg,
          borderRadius: theme.radius.md,
          opacity: pop.opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <Ionicons name={style.icon} size={18} color={style.fg} style={styles.icon} />
      <View style={styles.messages}>
        {messages.map((message, index) => (
          <Text
            key={`${message}-${String(index)}`}
            style={[theme.typography.small, { color: style.fg }]}
          >
            {message}
          </Text>
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', gap: 8, padding: 12 },
  icon: { marginTop: 1 },
  messages: { flex: 1, gap: 4 },
});
