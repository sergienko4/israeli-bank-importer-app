/**
 * Update prompt: a non-blocking banner shown when a newer version is waiting.
 *
 * Two cases share one surface. An over-the-air update downloads itself in the
 * background and only needs a restart, so the banner offers one instead of
 * silently swapping the app out from under the user. A release that changed
 * native code cannot arrive that way, so the banner links to the installable
 * package on GitHub Releases instead.
 *
 * The banner yields to {@link ReconnectBanner}: both float at the top, and
 * asking someone to restart while they are locked out of their session would
 * be the wrong thing to put in front of them.
 */
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { isEnabled, reloadAsync, useUpdates } from 'expo-updates';
import { type ReactElement, useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/ui';
import { haptics } from '../lib/haptics';
import { resolveOtaState, resolveUpdatePrompt, type UpdatePrompt } from '../lib/otaUpdate';
import { type AvailableRelease, fetchLatestRelease } from '../lib/releaseCheck';
import { useTheme } from '../theme/ThemeContext';

/** The version bundled into the running binary. */
const RUNNING_VERSION = Constants.expoConfig?.version ?? '0.0.0';

/** Copy for each prompt, keyed by what the tap will do. */
const COPY = {
  restart: {
    icon: 'rocket-outline',
    title: 'Update ready',
    detail: 'Restart to apply the latest version.',
    action: 'Restart',
  },
  download: {
    icon: 'cloud-download-outline',
    title: 'New version available',
    detail: 'This release needs a fresh install.',
    action: 'Download',
  },
} as const satisfies Record<
  Exclude<UpdatePrompt, 'none'>,
  { icon: keyof typeof Ionicons.glyphMap; title: string; detail: string; action: string }
>;

/**
 * Looks up the newest installable build once per launch.
 *
 * Only Android has a sideload path, and the unauthenticated GitHub API allows
 * 60 requests an hour per address, so this deliberately runs once and never
 * polls.
 * @returns The newer release, or null while unknown or already up to date.
 */
function useLatestRelease(): AvailableRelease | null {
  const [release, setRelease] = useState<AvailableRelease | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }
    let active = true;
    void fetchLatestRelease(RUNNING_VERSION).then((found) => {
      if (active) {
        setRelease(found);
      }
    });
    return () => {
      active = false;
    };
  }, []);
  return release;
}

/**
 * Renders the update prompt (nothing when the app is already current).
 * @returns The banner element, or null when there is nothing to offer.
 */
export function UpdateBanner(): ReactElement | null {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { sessionExpired } = useAuth();
  const { isDownloading, isUpdatePending, isRestarting } = useUpdates();
  const release = useLatestRelease();
  const [busy, setBusy] = useState(false);

  const state = resolveOtaState({ isEnabled, isDownloading, isUpdatePending, isRestarting });
  const prompt = resolveUpdatePrompt(state, release !== null);

  if (prompt === 'none' || sessionExpired) {
    return null;
  }

  const copy = COPY[prompt];
  const detail =
    prompt === 'download' && release !== null
      ? `Version ${release.version} is ready to install.`
      : copy.detail;

  const onPress = (): void => {
    haptics.medium();
    if (prompt === 'restart') {
      setBusy(true);
      void reloadAsync().catch(() => {
        setBusy(false);
      });
      return;
    }
    if (release !== null) {
      void Linking.openURL(release.downloadUrl).catch(() => {
        /* the browser is unavailable — nothing useful to say */
      });
    }
  };

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
          <Ionicons name={copy.icon} size={16} color={theme.colors.primary} />
        </View>
        <View style={styles.text}>
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[theme.typography.bodyMedium, { color: theme.colors.text }]}
          >
            {copy.title}
          </Text>
          <Text style={[theme.typography.small, { color: theme.colors.textMuted }]}>{detail}</Text>
        </View>
        <Button title={copy.action} size="sm" fullWidth={false} loading={busy} onPress={onPress} />
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
