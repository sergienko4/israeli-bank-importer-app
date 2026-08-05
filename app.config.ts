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
 * On by default, and deliberately not something a workflow has to remember to
 * set. `eas build` resolves the app config on an EAS builder while `eas update`
 * resolves it on a GitHub runner, so a value carried in the environment would
 * have to be repeated in four workflows. Missing one would not fail: the two
 * would simply resolve to different configs, and under the `fingerprint`
 * runtime version policy a different config is a different runtime id, so
 * updates would quietly stop reaching the binary. A committed default cannot
 * drift apart that way.
 *
 * @returns True unless the build opted out with `OTP_SMS_AUTOREAD=0`.
 */
function isAutoReadBuild(): boolean {
  return process.env.OTP_SMS_AUTOREAD !== '0';
}

/**
 * Adds the auto-read receiver and its service to the Android manifest.
 *
 * Kept out of the module's own manifest on purpose. That one is merged into
 * every build, and a receiver present in a build made with `OTP_SMS_AUTOREAD=0`
 * would make the "this build cannot read messages" claim rest on the missing
 * permission alone rather than on there being nothing to run.
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
