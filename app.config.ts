import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Dynamic app config. Everything static still lives in `app.json`; this file
 * exists for one reason — the SMS auto-read permission must be decided at
 * build time rather than baked in.
 *
 * A permission in the manifest is present for every user of that binary,
 * whether or not they ever turn the feature on, and it shows on the app's
 * permission screen. Computing it here keeps the default build's "this app
 * holds no SMS permission" claim literally true instead of merely unused.
 */

/** Receives messages as they arrive. Never granted by the default build. */
const RECEIVE_SMS = 'android.permission.RECEIVE_SMS';

/**
 * Reads the inbox, including everything that arrived before the app was
 * installed. No part of this feature needs history, so it is blocked in every
 * build — including the auto-read one — so a dependency cannot introduce it.
 */
const READ_SMS = 'android.permission.READ_SMS';

/**
 * Whether this build may capture one-time codes without a per-message tap.
 *
 * Set `OTP_SMS_AUTOREAD=1` to opt a build in. Any other value, including
 * unset, produces the default build.
 *
 * @returns `true` when the auto-read permission should enter the manifest.
 */
function isAutoReadBuild(): boolean {
  return process.env.OTP_SMS_AUTOREAD === '1';
}

/**
 * Merges the build-flag-dependent fields over the static `app.json` config.
 *
 * @param context - The Expo config context carrying the static config.
 * @returns The resolved config for this build.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const autoRead = isAutoReadBuild();

  return {
    ...config,
    name: config.name ?? 'Israeli Bank Importer',
    slug: config.slug ?? 'israeli-bank-importer-app',
    android: {
      ...config.android,
      blockedPermissions: [READ_SMS],
      ...(autoRead ? { permissions: [RECEIVE_SMS] } : {}),
    },
    extra: {
      ...config.extra,
      otpSmsAutoRead: autoRead,
    },
  };
};
