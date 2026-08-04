import type { AndroidManifest, ConfigPlugin } from '@expo/config-plugins';
import * as configPluginsModule from '@expo/config-plugins';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * The two loaders that read this file disagree about how to reach a CommonJS
 * module, and `@expo/config-plugins` defines its exports as lazy getters, which
 * makes the disagreement fatal rather than cosmetic.
 *
 * Under the ESM loader `eas update:configure` uses, the getters are invisible,
 * so named imports fail and only `default` holds the exports. Under the
 * transpiled CommonJS path `expo config` and `expo prebuild` use, there is no
 * synthesized `default` at all. Taking whichever exists satisfies both.
 */
const configPlugins =
  (configPluginsModule as typeof configPluginsModule & { default?: typeof configPluginsModule })
    .default ?? configPluginsModule;

const { AndroidConfig, withAndroidManifest } = configPlugins;

/** The receiver entry shape, taken from the manifest type this plugin edits. */
type ManifestReceiver = NonNullable<
  NonNullable<AndroidManifest['manifest']['application']>[number]['receiver']
>[number];

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

/** The receiver's fully qualified name, as the merged manifest must spell it. */
const RECEIVER = 'expo.modules.otpsmsconsent.OtpSmsAutoReadReceiver';

/** The headless service the receiver starts. */
const SERVICE = 'expo.modules.otpsmsconsent.OtpSmsAutoReadService';

/**
 * Held by the system alone, so requiring it means only the OS can deliver to
 * the receiver. Without it any app on the device could forge a message and
 * feed this one a code of its choosing.
 */
const BROADCAST_SMS = 'android.permission.BROADCAST_SMS';

/**
 * Adds the auto-read receiver and its service to the Android manifest.
 *
 * Kept out of the module's own manifest on purpose. That one is merged into
 * every build, and a receiver present in the default build would make the
 * "this build cannot read messages" claim rest on the missing permission alone
 * rather than on there being nothing to run.
 *
 * @param config - The config to extend.
 * @returns The config with the receiver and service declared.
 */
const withOtpSmsAutoRead: ConfigPlugin = (config) =>
  withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);

    // Declared separately because the manifest types do not carry
    // `android:permission` for a receiver, though the format does.
    const attributes: ManifestReceiver['$'] & { 'android:permission': string } = {
      'android:name': RECEIVER,
      // The system sends this broadcast, so it has to be reachable.
      'android:exported': 'true',
      'android:permission': BROADCAST_SMS,
    };

    application.receiver = [
      ...(application.receiver ?? []),
      {
        $: attributes,
        'intent-filter': [
          { action: [{ $: { 'android:name': 'android.provider.Telephony.SMS_RECEIVED' } }] },
        ],
      },
    ];

    application.service = [
      ...(application.service ?? []),
      { $: { 'android:name': SERVICE, 'android:exported': 'false' } },
    ];

    return mod;
  });

/**
 * Merges the build-flag-dependent fields over the static `app.json` config.
 *
 * @param context - The Expo config context carrying the static config.
 * @returns The resolved config for this build.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const autoRead = isAutoReadBuild();

  const resolved: ExpoConfig = {
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

  // Applied here rather than listed in `plugins` so the default build's config
  // never even names it.
  return autoRead ? withOtpSmsAutoRead(resolved) : resolved;
};
