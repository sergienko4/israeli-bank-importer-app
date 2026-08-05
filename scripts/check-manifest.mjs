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
  const env = { ...process.env };
  // Deleted rather than left alone: a developer with the variable exported
  // would otherwise silently check something other than what ships.
  delete env.OTP_SMS_AUTOREAD;
  if (flag !== undefined) {
    env.OTP_SMS_AUTOREAD = flag;
  }

  // Expo's CLI is run through node directly: npx resolves to a .cmd on Windows,
  // which cannot be spawned without a shell.
  const stdout = execFileSync(
    process.execPath,
    [
      createRequire(import.meta.url).resolve('expo/bin/cli'),
      'config',
      '--type',
      'introspect',
      '--json',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env },
  );
  return JSON.parse(stdout);
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
 * Asserts the manifest of a build that may capture codes.
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
    'extra.otpSmsAutoRead should be true by default, so the app enables the feature',
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
}

/**
 * Asserts the manifest of a build that opted out.
 *
 * @param {object} config - The introspected config.
 */
function checkOptOutBuild(config) {
  const manifest = manifestOf(config);
  const permissions = names(manifest, 'uses-permission');

  check(
    config.extra?.otpSmsAutoRead === false,
    'extra.otpSmsAutoRead should be false when the build set OTP_SMS_AUTOREAD=0',
  );
  check(
    !permissions.includes(RECEIVE_SMS),
    `${RECEIVE_SMS} should be absent from an opted-out build`,
  );
  check(
    names(manifest.application[0], 'receiver').every((name) => name !== RECEIVER),
    'the receiver should be absent from an opted-out build, so there is nothing to run',
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
    const autoRead = resolveConfig(undefined);
    checkAutoReadBuild(autoRead);
    checkBothBuilds(autoRead, 'default');

    const optOut = resolveConfig('0');
    checkOptOutBuild(optOut);
    checkBothBuilds(optOut, 'opted-out');

    if (failures.length > 0) {
      console.error(
        'The resolved Android manifest does not match what the app expects:\n' +
          failures.map((failure) => `  - ${failure}`).join('\n') +
          '\n\nThe wiring is in app.config.ts. An app built from this manifest would\n' +
          'not capture one-time codes, and no other check would notice.',
      );
      process.exitCode = 1;
    } else {
      console.log('The resolved Android manifest wires up SMS auto-read in both build directions.');
    }
  }
} catch (error) {
  console.error(`Could not resolve the app config to check it: ${error.message}`);
  process.exitCode = 1;
}
