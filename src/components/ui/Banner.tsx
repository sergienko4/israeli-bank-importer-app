/**
 * Inline banner for validation errors, warnings, or success notices. Conveys
 * tone with a tinted background and an icon alongside one or more messages, and
 * can carry the one action that resolves what it reports.
 *
 * Nothing here dismisses itself. A banner reports a state, and it is the
 * caller's job to stop rendering it once that state is no longer true — a
 * message that vanishes on a timer takes the explanation with it.
 */
import { Ionicons } from '@expo/vector-icons';
import type { ReactElement } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { useMountPop } from '../../lib/useMountPop';
import type { Theme } from '../../theme/ThemeContext';
import { useTheme } from '../../theme/ThemeContext';

/** Banner tone. */
export type BannerTone = 'danger' | 'success' | 'warning' | 'info';

/** The single way out of what a banner reports. */
export interface BannerAction {
  /** Labelled as the thing it does: "Try again", not "OK". */
  label: string;
  /** Runs when the button is pressed. */
  onPress: () => void;
}

interface BannerProps {
  /** One or more lines to display. */
  messages: string[];
  /** Tone. Default `danger`. */
  tone?: BannerTone;
  /** Optional recovery action, rendered as a button inside the banner. */
  action?: BannerAction;
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
export function Banner({
  messages,
  tone = 'danger',
  action,
}: Readonly<BannerProps>): ReactElement | null {
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
        {action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={action.onPress}
            hitSlop={12}
            style={({ pressed }) => [styles.action, pressed ? styles.actionPressed : null]}
          >
            <Text style={[theme.typography.small, styles.actionLabel, { color: style.fg }]}>
              {action.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', gap: 8, padding: 12 },
  icon: { marginTop: 1 },
  messages: { flex: 1, gap: 4 },
  // 20pt of text plus 12pt hitSlop top and bottom clears the 44pt minimum.
  action: { alignSelf: 'flex-start', paddingVertical: 4 },
  actionPressed: { opacity: 0.6 },
  // Underlined so the action is not signalled by colour alone.
  actionLabel: { fontWeight: '700', textDecorationLine: 'underline' },
});
