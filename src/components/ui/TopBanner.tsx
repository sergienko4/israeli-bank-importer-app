/**
 * Floating banner pinned under the status bar, for the few notices that have to
 * survive whatever screen the user is on: an expired session, a waiting update.
 *
 * Presentational only. It takes the copy and one action; whether to appear at
 * all, and which of several banners wins the slot, stays with the caller.
 */
import { Ionicons } from '@expo/vector-icons';
import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../../theme/ThemeContext';
import { Button } from './Button';

/** Icon name accepted by {@link TopBanner}. */
export type TopBannerIcon = keyof typeof Ionicons.glyphMap;

interface TopBannerProps {
  /** Icon shown in the tinted pill. */
  icon: TopBannerIcon;
  /** Headline. Announced when the banner appears. */
  title: string;
  /** Supporting line under the headline. */
  detail: string;
  /** Label of the single action. */
  actionTitle: string;
  /** Whether the action is running. Default `false`. */
  busy?: boolean;
  /** Called when the action is tapped. */
  onPress: () => void;
}

/**
 * Renders a floating notice with a single action.
 * @param props - Icon, copy, and the action to offer.
 * @returns The banner element.
 */
export function TopBanner({
  icon,
  title,
  detail,
  actionTitle,
  busy = false,
  onPress,
}: TopBannerProps): ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.wrap, { top: insets.top + theme.spacing.sm }]} pointerEvents="box-none">
      <View
        style={[
          styles.banner,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.lg,
          },
          theme.shadow(2),
        ]}
      >
        <View
          style={[
            styles.icon,
            { backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.pill },
          ]}
        >
          <Ionicons name={icon} size={16} color={theme.colors.primary} />
        </View>
        <View style={styles.text}>
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[theme.typography.bodyMedium, { color: theme.colors.text }]}
          >
            {title}
          </Text>
          <Text style={[theme.typography.small, { color: theme.colors.textMuted }]}>{detail}</Text>
        </View>
        <Button title={actionTitle} size="sm" fullWidth={false} loading={busy} onPress={onPress} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 10 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderWidth: 1,
  },
  icon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
});
