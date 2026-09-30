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
import Constants from 'expo-constants';
import { isEnabled, reloadAsync, useUpdates } from 'expo-updates';
import { type ReactElement, useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';

import { useAuth } from '../auth/AuthContext';
import { TopBanner, type TopBannerIcon } from '../components/ui';
import { haptics } from '../lib/haptics';
import { resolveOtaState, resolveUpdatePrompt, type UpdatePrompt } from '../lib/otaUpdate';
import { isAutoReadBuild } from '../lib/otpAutoReadPermission';
import {
  apkAssetFor,
  type AvailableRelease,
  fetchLatestRelease,
  SMS_APK_INSTALL_COMMAND,
} from '../lib/releaseCheck';

/**
 * The version of the running update. `Constants.expoConfig` is read from the
 * update's manifest, and versions take no part in the runtime fingerprint, so
 * after an over-the-air update this can be newer than the installed binary.
 */
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
  { icon: TopBannerIcon; title: string; detail: string; action: string }
>;

/**
 * What the download prompt says about installing a release.
 *
 * Play Protect blocks browser and files-app installation of the SMS build on
 * affected devices, so this gives every user the consistent ADB path.
 * @param version - The release version.
 * @returns The detail line.
 */
function downloadDetail(version: string): string {
  return isAutoReadBuild()
    ? `Version ${version} is ready. Install it from a computer: ${SMS_APK_INSTALL_COMMAND}.`
    : `Version ${version} is ready to install.`;
}

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
    void fetchLatestRelease(RUNNING_VERSION, apkAssetFor(isAutoReadBuild())).then((found) => {
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
    prompt === 'download' && release !== null ? downloadDetail(release.version) : copy.detail;

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
    <TopBanner
      icon={copy.icon}
      title={copy.title}
      detail={detail}
      actionTitle={copy.action}
      busy={busy}
      onPress={onPress}
    />
  );
}
