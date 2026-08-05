import type { ConfigPlugin } from '@expo/config-plugins';
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

/**
 * Dynamic app config. Everything static still lives in `app.json`; this file
 * exists for one reason - the SMS auto-read permission must be decided at
 * build time rather than baked in.
 *
 * A permission in the manifest is present for every user of that binary,
 * whether or not they ever turn the feature on, and it shows on the app's
 * permission screen. Deciding it here is what lets a build leave it out
 * entirely rather than ship it unused.
 *
 * Nothing here is imported from the app's own source. Expo transpiles this one
 * file and requires the result directly, so a relative import of a TypeScript
 * module cannot be resolved and the config fails to load. That rules out
 * testing these decisions from a unit test, which is why `check:manifest`
 * asserts them against the manifest Expo actually produces.
 */

/** The auto-read receiver's fully qualified name, as the merged manifest spells it. */
const AUTO_READ_RECEIVER = 'expo.modules.otpsmsconsent.OtpSmsAutoReadReceiver';

/** The headless service the receiver starts. */
const AUTO_READ_SERVICE = 'expo.modules.otpsmsconsent.OtpSmsAutoReadService';

/**
 * Held by the system alone, so requiring it means only the OS can deliver to
 * the receiver. Without it any app on the device could forge a message and
 * feed this one a code of its choosing.
 */
const BROADCAST_SMS = 'android.permission.BROADCAST_SMS';

/** The broadcast Android delivers even to an app that is not running. */
const SMS_RECEIVED_ACTION = 'android.provider.Telephony.SMS_RECEIVED';

/** Lets the app be told a message arrived. It cannot read anything already there. */
const RECEIVE_SMS = 'android.permission.RECEIVE_SMS';

/** Reading the message history. Refused outright, in every build. */
const READ_SMS = 'android.permission.READ_SMS';

/** The application node the manifest plugin edits. */
type ManifestApplication = Parameters<
  typeof AndroidConfig.Manifest.getMainApplicationOrThrow
>[0]['manifest']['application'] extends readonly (infer Entry)[] | undefined
  ? Entry
  : never;

/**
 * Whether this build may capture one-time codes without a per-message tap.
 *
 * Off by default, because declaring `RECEIVE_SMS` makes the APK impossible to
 * install. Google Play Protect's enhanced fraud protection hard-blocks the
 * sideloaded installation of any app declaring an SMS permission — there is no
 * "install anyway" — and a GitHub release APK is a sideload by definition. The
 * permission is also outside what Google Play grants to an app that is not the
 * device's default SMS handler, so publishing to the store would not recover it
 * either. A default of "on" therefore ships a release nobody can install, which
 * is what happened in `v0.2.9`.
 *
 * Everything the feature needs is still compiled in and still tested; only the
 * manifest declaration is withheld. Build with `OTP_SMS_AUTOREAD=1` to get it
 * back, and install that APK over `adb`, which does not consult Play Protect.
 *
 * Set it for `eas update` as well as for the build if you do. `eas build`
 * resolves this config on one machine and `eas update` on another, and under the
 * `fingerprint` runtime version policy a different config is a different runtime
 * id — so setting it for only one of the two would leave updates unable to reach
 * the binary. Leaving it unset everywhere, which is the default, cannot drift
 * that way.
 *
 * @returns True only when the build opted in with `OTP_SMS_AUTOREAD=1`.
 */
function isAutoReadBuild(): boolean {
  return process.env.OTP_SMS_AUTOREAD === '1';
}

/**
 * Adds the auto-read receiver and its service to the Android manifest.
 *
 * Kept out of the module's own manifest on purpose. That one is merged into
 * every build, and a receiver present in a build made without
 * `OTP_SMS_AUTOREAD=1` would make the "this build cannot read messages" claim
 * rest on the missing permission alone rather than on there being nothing to
 * run.
 *
 * Each entry replaces any earlier one of the same name rather than being added
 * beside it. Prebuild is not always run against an empty folder, and two
 * declarations of one component fail the manifest merger outright.
 *
 * @param config - The config to extend.
 * @returns The config with the receiver and service declared.
 */
const withOtpSmsAutoRead: ConfigPlugin = (config) =>
  withAndroidManifest(config, (mod) => {
    const application: ManifestApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(
      mod.modResults,
    );

    // Declared separately because the manifest types do not carry
    // `android:permission` for a receiver, though the format does.
    const attributes: NonNullable<ManifestApplication['receiver']>[number]['$'] & {
      'android:permission': string;
    } = {
      'android:name': AUTO_READ_RECEIVER,
      // The system sends this broadcast, so it has to be reachable.
      'android:exported': 'true',
      'android:permission': BROADCAST_SMS,
    };

    application.receiver = [
      ...(application.receiver ?? []).filter(
        (entry) => entry.$['android:name'] !== AUTO_READ_RECEIVER,
      ),
      {
        $: attributes,
        'intent-filter': [{ action: [{ $: { 'android:name': SMS_RECEIVED_ACTION } }] }],
      },
    ];

    application.service = [
      ...(application.service ?? []).filter(
        (entry) => entry.$['android:name'] !== AUTO_READ_SERVICE,
      ),
      { $: { 'android:name': AUTO_READ_SERVICE, 'android:exported': 'false' } },
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
