/**
 * Fails the build when SMS auto-read is not actually wired into the manifest.
 *
 * The feature shipped once with correct Kotlin, correct JavaScript, and nothing
 * in the manifest to run either of them. Every gate passed: it typechecked, it
 * bundled, the tests were green, and the installed app could not read a message
 * because it had never asked for the permission and declared no receiver to be
 * handed one. The wiring lives in `app.config.ts`, which no test can import -
 * Expo transpiles that file alone and requires the result, so a relative import
 * of the app's own source cannot be resolved - and which nothing else reads.
 *
 * So the manifest Expo produces is checked here instead, in both directions the
 * build flag allows, because "the permission is absent" is the correct answer
 * for one of them and the bug for the other.
 *
 * The same file routes an auto-read build's updates to its own channel and lets
 * a build outside EAS set its versionCode, and neither has any other reader
 * before a release, so both are checked here too.
 *
 * Usage:
 *   node scripts/check-manifest.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

/** Lets the app be told a message arrived. Present only in an auto-read build. */
const RECEIVE_SMS = 'android.permission.RECEIVE_SMS';

/** Reading the message history. Must be refused in every build. */
const READ_SMS = 'android.permission.READ_SMS';

/** Lets the capture service outlive the freeze that follows the broadcast. */
const FOREGROUND_SERVICE = 'android.permission.FOREGROUND_SERVICE';

/** The receiver the system hands the broadcast to. */
const RECEIVER = 'expo.modules.otpsmsconsent.OtpSmsAutoReadReceiver';

/** The headless service that receiver starts. */
const SERVICE = 'expo.modules.otpsmsconsent.OtpSmsAutoReadService';

/**
 * The broadcast that reaches an app which is not running. Its presence is what
 * makes a code capturable with the app closed, so it is asserted by name.
 */
const SMS_RECEIVED = 'android.provider.Telephony.SMS_RECEIVED';

/**
 * The manifest meta that carries `updates.requestHeaders` into the binary. A
 * build made outside EAS Build has no other way to name its update channel.
 */
const REQUEST_HEADERS_META = 'expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY';

/** The channel an auto-read build asks for, kept apart from the standard one. */
const AUTO_READ_CHANNEL = 'production-sms';

/** The variable a build outside EAS sets its versionCode with. */
const VERSION_CODE_VARIABLE = 'ANDROID_VERSION_CODE';

/**
 * Values the versionCode variable must refuse: zero, a leading zero, text, a
 * fraction, a negative, one past Play's 2100000000 limit, and the empty string
 * an unset workflow expression expands to.
 */
const INVALID_VERSION_CODES = ['0', '01', 'abc', '4.2', '-1', '2100000001', ''];

/**
 * Runs `expo config` with exactly the build variables given.
 *
 * @param {{ flag?: string, versionCode?: string, type?: string }} options - The
 *   value of `OTP_SMS_AUTOREAD` and of the versionCode variable, each left unset
 *   when omitted, which is how a release build resolves them, and the config
 *   type to print.
 * @returns {string} What the command printed.
 */
function runExpoConfig({ flag, versionCode, type = 'introspect' }) {
  const env = { ...process.env };
  // Deleted rather than left alone: a developer with either variable exported
  // would otherwise silently check something other than what ships.
  delete env.OTP_SMS_AUTOREAD;
  delete env.ANDROID_VERSION_CODE;
  if (flag !== undefined) {
    env.OTP_SMS_AUTOREAD = flag;
  }
  if (versionCode !== undefined) {
    env.ANDROID_VERSION_CODE = versionCode;
  }

  // Expo's CLI is run through node directly: npx resolves to a .cmd on Windows,
  // which cannot be spawned without a shell.
  return execFileSync(
    process.execPath,
    [createRequire(import.meta.url).resolve('expo/bin/cli'), 'config', '--type', type, '--json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env },
  );
}

/**
 * Resolves the app config the way a build does.
 *
 * `introspect` is the type that runs the config plugins, so the manifest it
 * returns is the one prebuild would write. Any other type would report the
 * config's intent rather than its result, which is the gap this exists to close.
 *
 * @param {string | undefined} flag - The value of `OTP_SMS_AUTOREAD`, or
 *   `undefined` to leave it unset, which is how a release build resolves it.
 * @returns {object} The introspected config.
 */
function resolveConfig(flag) {
  return JSON.parse(runExpoConfig({ flag }));
}

/**
 * The Android manifest from an introspected config.
 *
 * @param {object} config - The introspected config.
 * @returns {object} The manifest's root node.
 */
function manifestOf(config) {
  return config._internal.modResults.android.manifest.manifest;
}

/**
 * The names of a manifest node's entries of one kind.
 *
 * @param {object} node - The node holding them.
 * @param {string} kind - The child element name, such as `receiver`.
 * @returns {string[]} Every `android:name` declared, in order.
 */
function names(node, kind) {
  return (node[kind] ?? []).map((entry) => entry.$['android:name']);
}

/**
 * The value of one `meta-data` entry on the application node.
 *
 * @param {object} config - The introspected config.
 * @param {string} name - The entry's `android:name`.
 * @returns {string[]} The value of every entry with that name, in order.
 */
function metaValues(config, name) {
  return (manifestOf(config).application[0]['meta-data'] ?? [])
    .filter((entry) => entry.$['android:name'] === name)
    .map((entry) => entry.$['android:value']);
}

/**
 * Whether a string is JSON naming exactly the auto-read channel.
 *
 * @param {string} value - The meta's value.
 * @returns {boolean} True when it parses to that one header and nothing else.
 */
function namesAutoReadChannel(value) {
  try {
    const headers = JSON.parse(value);
    return Object.keys(headers).length === 1 && headers['expo-channel-name'] === AUTO_READ_CHANNEL;
  } catch {
    return false;
  }
}

/** Collected failures, reported together so one run shows every problem. */
const failures = [];

/**
 * Records a failure unless the condition holds.
 *
 * @param {boolean} condition - What must be true.
 * @param {string} description - What was expected, phrased for a reader.
 */
function check(condition, description) {
  if (!condition) {
    failures.push(description);
  }
}

/**
 * Asserts the manifest of an opt-in build, which may capture codes.
 *
 * @param {object} config - The introspected config.
 */
function checkAutoReadBuild(config) {
  const manifest = manifestOf(config);
  const application = manifest.application[0];
  const permissions = names(manifest, 'uses-permission');
  const receivers = names(application, 'receiver');
  const services = names(application, 'service');

  check(
    config.extra?.otpSmsAutoRead === true,
    'extra.otpSmsAutoRead should be true when the build set OTP_SMS_AUTOREAD=1',
  );
  check(
    permissions.filter((name) => name === RECEIVE_SMS).length === 1,
    `${RECEIVE_SMS} should be requested exactly once`,
  );
  check(
    receivers.filter((name) => name === RECEIVER).length === 1,
    // Two declarations of one component fail the manifest merger, so this is
    // not merely untidy.
    `${RECEIVER} should be declared exactly once`,
  );
  check(
    services.filter((name) => name === SERVICE).length === 1,
    `${SERVICE} should be declared exactly once`,
  );
  check(
    permissions.includes(FOREGROUND_SERVICE),
    // Without it the service starts as an ordinary one, and Android freezes the
    // process before the code reaches the importer.
    `${FOREGROUND_SERVICE} should be requested, so the capture service can run in the foreground`,
  );

  const receiver = (application.receiver ?? []).find(
    (entry) => entry.$['android:name'] === RECEIVER,
  );
  const actions = (receiver?.['intent-filter'] ?? []).flatMap((filter) =>
    (filter.action ?? []).map((action) => action.$['android:name']),
  );
  check(
    actions.includes(SMS_RECEIVED),
    `the receiver should listen for ${SMS_RECEIVED}, which is what reaches a closed app`,
  );
  check(
    receiver?.$['android:exported'] === 'true',
    'the receiver should be exported, since the system is what delivers to it',
  );
  check(
    receiver?.$['android:permission'] === 'android.permission.BROADCAST_SMS',
    'the receiver should require BROADCAST_SMS, so only the system can reach it',
  );

  const service = (application.service ?? []).find((entry) => entry.$['android:name'] === SERVICE);
  check(
    service?.$['android:exported'] === 'false',
    // Only this app's own receiver ever starts it, and it acts on whatever body
    // it is handed. Exported, any app on the device could start it directly.
    'the service should not be exported, since only the receiver starts it',
  );
  check(
    service?.$['android:foregroundServiceType'] === 'shortService',
    // Android 14 refuses a foreground start for a service that declares no type.
    'the service should declare foregroundServiceType="shortService"',
  );

  const headers = metaValues(config, REQUEST_HEADERS_META);
  check(
    headers.length === 1 && namesAutoReadChannel(headers[0]),
    // Without it the binary asks for the standard channel and is offered
    // updates built for a different runtime, which it can never apply.
    `${REQUEST_HEADERS_META} should be declared once as {"expo-channel-name":"${AUTO_READ_CHANNEL}"}`,
  );
}

/**
 * Asserts the manifest of the default build, which ships without the permission.
 *
 * Play Protect refuses to install a sideloaded APK that declares an SMS
 * permission, so this is the build every release attaches.
 *
 * @param {object} config - The introspected config.
 */
function checkOptOutBuild(config) {
  const manifest = manifestOf(config);
  const permissions = names(manifest, 'uses-permission');

  check(
    config.extra?.otpSmsAutoRead === false,
    'extra.otpSmsAutoRead should be false by default, so the app hides the feature',
  );
  check(
    !permissions.includes(RECEIVE_SMS),
    `${RECEIVE_SMS} should be absent from the default build, which Play Protect would otherwise refuse to install`,
  );
  check(
    names(manifest.application[0], 'receiver').every((name) => name !== RECEIVER),
    'the receiver should be absent from the default build, so there is nothing to run',
  );
  check(
    names(manifest.application[0], 'service').every((name) => name !== SERVICE),
    'the service should be absent from the default build, so there is nothing to start',
  );
  check(
    metaValues(config, REQUEST_HEADERS_META).length === 0,
    `${REQUEST_HEADERS_META} should be absent from the default build, whose channel EAS Build sets`,
  );
}

/**
 * Asserts what must hold however the build was configured.
 *
 * @param {object} config - The introspected config.
 * @param {string} label - The build being described, for the failure message.
 */
function checkBothBuilds(config, label) {
  const blocked = (manifestOf(config)['uses-permission'] ?? []).some(
    (entry) => entry.$['android:name'] === READ_SMS && entry.$['tools:node'] === 'remove',
  );
  check(blocked, `${READ_SMS} should be stripped from the ${label} build's merged manifest`);
  check(
    config.android?.versionCode === undefined,
    // EAS Build owns the number through remote versioning; a value here would
    // be one EAS never sees.
    `android.versionCode should be unset in the ${label} build when ${VERSION_CODE_VARIABLE} is`,
  );
}

/**
 * Asserts that the versionCode variable is taken when valid and refused
 * otherwise.
 *
 * A build outside EAS copies the number from the standard APK of the same
 * release, and Android installs one over the other only when it matches. A
 * value that is quietly dropped or truncated would build an APK that cannot be
 * installed over the one it belongs with, so every malformed value must stop
 * the build instead.
 */
function checkVersionCode() {
  for (const value of ['42', '2100000000']) {
    const config = JSON.parse(runExpoConfig({ flag: '1', versionCode: value, type: 'public' }));
    check(
      config.android?.versionCode === Number(value),
      `${VERSION_CODE_VARIABLE}=${value} should resolve to android.versionCode ${value}`,
    );
  }

  for (const value of INVALID_VERSION_CODES) {
    let refused = false;
    try {
      runExpoConfig({ flag: '1', versionCode: value, type: 'public' });
    } catch (error) {
      refused = String(error.stderr).includes(VERSION_CODE_VARIABLE);
    }
    check(
      refused,
      `${VERSION_CODE_VARIABLE}=${JSON.stringify(value)} should stop config resolution with an error naming the variable`,
    );
  }
}

try {
  // Plugins are applied over whatever manifest is already on disk, so a local
  // prebuild folder would answer for app.config.ts: leftovers from an earlier
  // run can supply a declaration this is meant to prove, and can keep one an
  // opted-out build must not have. The folder is gitignored and regenerated by
  // the next prebuild, and CI never has one, so it is refused rather than
  // worked around.
  if (existsSync('android')) {
    console.error(
      'A local android/ folder is present, so the resolved manifest would be\n' +
        'merged over it rather than built from this config alone.\n' +
        'Remove it and run this again - `npx expo prebuild` recreates it.',
    );
    process.exitCode = 1;
  } else {
    const shipped = resolveConfig(undefined);
    checkOptOutBuild(shipped);
    checkBothBuilds(shipped, 'default');

    const optIn = resolveConfig('1');
    checkAutoReadBuild(optIn);
    checkBothBuilds(optIn, 'opted-in');

    checkVersionCode();

    if (failures.length > 0) {
      console.error(
        'The resolved Android manifest does not match what the app expects:\n' +
          failures.map((failure) => `  - ${failure}`).join('\n') +
          '\n\nThe wiring is in app.config.ts. An app built from this config would\n' +
          'ship broken, and no other check would notice.',
      );
      process.exitCode = 1;
    } else {
      console.log(
        'The resolved Android manifest wires up SMS auto-read in both build directions,\n' +
          `routes the auto-read build to ${AUTO_READ_CHANNEL}, and ${VERSION_CODE_VARIABLE} is validated.`,
      );
    }
  }
} catch (error) {
  console.error(`Could not resolve the app config to check it: ${error.message}`);
  process.exitCode = 1;
}
