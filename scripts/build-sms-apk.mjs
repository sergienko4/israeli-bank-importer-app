/**
 * Builds the SMS auto-read APK without EAS Build, and proves it belongs with the
 * standard APK of the same release.
 *
 * The standard APK cannot declare `RECEIVE_SMS`: on affected devices, Play
 * Protect blocks its browser or files-app installation. The SMS APK is the same
 * app with that permission, installed over `adb`. Android accepts one over the
 * other only when both carry the same package, the same versionCode or a higher
 * one, and the same signing certificate, and the SMS APK receives updates only
 * when its runtime matches the updates published to its channel. A build that
 * misses any of those still builds, signs and installs on a clean device - it
 * just never installs over the other APK, or never updates - so each is asserted
 * on the signed file itself.
 *
 * The reference is the standard APK of the same release, which EAS Build made:
 * its versionCode is copied into this build, and its versionName and signer
 * must match. `--self-reference` is for a pull-request check, which has no
 * release APK: the keystore's own certificate, the app config's versionName and
 * `ANDROID_VERSION_CODE` stand in for it.
 *
 * `app.json` needs `updates.url`, or prebuild writes `expo.modules.updates.ENABLED`
 * as false. `eas update:configure` writes it, but needs an Expo account. When it
 * is absent the URL is derived from `extra.eas.projectId` exactly as that
 * command would write it, and the file is put back byte for byte afterwards,
 * however the run ends. Prebuild also rewrites the `android` and `ios` scripts
 * in `package.json`, so that file is put back the same way. The generated
 * `android` project is short-lived CNG output and is removed on every exit.
 *
 * Usage:
 *   node scripts/build-sms-apk.mjs --reference <standard.apk> --out <sms.apk> [--abi x86_64]
 *   node scripts/build-sms-apk.mjs --self-reference --out <sms.apk> [--abi x86_64]
 *
 * Environment: ANDROID_HOME, ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD,
 * ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD, and ANDROID_VERSION_CODE with
 * `--self-reference`. The passwords are handed to `keytool` and `apksigner` by
 * variable name, never on a command line, and are removed from the environment
 * prebuild and Gradle run in.
 *
 * Exit status: 0, with a JSON summary as the last line of stdout; 1 when the
 * build fails or an invariant does not hold, each one listed on stderr; 2 on a
 * usage error; 130 or 143 when stopped by SIGINT or SIGTERM. On any status but
 * 0 and 2, nothing is left at `--out`. Linux and macOS only.
 */

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { constants } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  describeSigningSchemes,
  parseApkSignatureProfile,
  sameSigningSchemes,
  signingSchemeArguments,
} from './apk-signature-profile.mjs';

const require = createRequire(import.meta.url);

/** The repository root, whatever directory the script is started from. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The static config `updates.url` is read from and, when absent, written to. */
const APP_JSON = join(ROOT, 'app.json');

/** The package manifest, whose scripts prebuild rewrites. */
const PACKAGE_JSON = join(ROOT, 'package.json');

/** Where prebuild writes the native project. */
const ANDROID_DIR = join(ROOT, 'android');

/** Gradle's output: the release variant, signed with the template's debug key. */
const BUILT_APK = join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');

/** Lets the app be told a message arrived. The reason this APK exists. */
const RECEIVE_SMS = 'android.permission.RECEIVE_SMS';

/** Reading the message history. Refused in every build. */
const READ_SMS = 'android.permission.READ_SMS';

/** Held by the system alone, so only the OS can deliver to the receiver. */
const BROADCAST_SMS = 'android.permission.BROADCAST_SMS';

/** The broadcast that reaches an app which is not running. */
const SMS_RECEIVED = 'android.provider.Telephony.SMS_RECEIVED';

/** The receiver the system hands the broadcast to. */
const RECEIVER = 'expo.modules.otpsmsconsent.OtpSmsAutoReadReceiver';

/** The headless service that receiver starts. */
const SERVICE = 'expo.modules.otpsmsconsent.OtpSmsAutoReadService';

/** The manifest meta naming the update channel of a build made outside EAS. */
const REQUEST_HEADERS_META = 'expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY';

/** The manifest meta holding the update server's URL. */
const UPDATE_URL_META = 'expo.modules.updates.EXPO_UPDATE_URL';

/** The manifest meta that switches updates off when false. */
const ENABLED_META = 'expo.modules.updates.ENABLED';

/** The channel this APK's updates are published to. */
const AUTO_READ_CHANNEL = 'production-sms';

/** The ABIs React Native builds for; `--abi` takes a comma-separated subset. */
const ABIS = ['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'];

/** Variables every run needs. */
const REQUIRED_ENV = [
  'ANDROID_HOME',
  'ANDROID_KEYSTORE_PATH',
  'ANDROID_KEYSTORE_PASSWORD',
  'ANDROID_KEY_ALIAS',
  'ANDROID_KEY_PASSWORD',
];

/** Variables no child but `keytool` and `apksigner` may see. */
const SECRET_ENV = ['ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_PASSWORD'];

/**
 * The environment inherited by commands that do not need signing passwords.
 *
 * @returns {NodeJS.ProcessEnv} A copy without either password.
 */
function sanitizedEnvironment() {
  const dropped = new Set(SECRET_ENV);
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !dropped.has(name)));
}

/**
 * The environment inherited only by commands that consume signing passwords.
 *
 * @returns {NodeJS.ProcessEnv} The sanitized environment plus both passwords.
 */
function signingEnvironment() {
  return {
    ...sanitizedEnvironment(),
    ANDROID_KEYSTORE_PASSWORD: process.env.ANDROID_KEYSTORE_PASSWORD,
    ANDROID_KEY_PASSWORD: process.env.ANDROID_KEY_PASSWORD,
  };
}

/** How long a stopped build may take to exit before it is killed outright. */
const GRACE_MS = 30_000;

/** Signature files a JAR (v1) signature leaves in the archive. */
const V1_SIGNATURE_ENTRY = /^META-INF\/[^/]+\.(?:SF|RSA|DSA|EC)$/iu;

/** The EAS-built standard APK's current profile, used when CI has no reference APK. */
const SELF_REFERENCE_SCHEMES = {
  v1: false,
  v2: true,
  v3: false,
  'v3.1': false,
  v4: false,
};

/** A usage mistake: exits 2 without touching anything. */
class UsageError extends Error {}

/** One or more invariants did not hold: exits 1, listing each. */
class InvariantError extends Error {
  /**
   * @param {string[]} failures - Each failed invariant, named first.
   */
  constructor(failures) {
    super(failures.join('\n'));
    this.failures = failures;
  }
}

/** The run was stopped by a signal: exits 128 plus the signal's number. */
class InterruptedError extends Error {}

/**
 * What the signal handlers need to reach: the signal received, if any, the
 * long-running child in flight, and the promise that settles once that child's
 * process group is gone.
 *
 * @type {{ signal?: NodeJS.Signals, child?: import('node:child_process').ChildProcess, stopping?: Promise<void> }}
 */
const state = {};

/**
 * Writes a progress line to stderr, which keeps stdout for the summary alone.
 *
 * @param {string} message - What to report.
 */
function log(message) {
  process.stderr.write(`[build-sms-apk] ${message}\n`);
}

/**
 * Throws once a stop signal has arrived, so no new step starts after it.
 */
function checkpoint() {
  if (state.signal !== undefined) {
    throw new InterruptedError(state.signal);
  }
}

/**
 * Whether any process of a group is still alive.
 *
 * @param {number} pgid - The group's id, which is its leader's pid.
 * @returns {boolean} False once the group is empty.
 */
function groupAlive(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/**
 * Sends a signal to a whole process group, ignoring a group already gone.
 *
 * @param {number} pgid - The group's id.
 * @param {NodeJS.Signals} signal - The signal to send.
 */
function signalGroup(pgid, signal) {
  try {
    process.kill(-pgid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') {
      throw error;
    }
  }
}

/**
 * Stops a process group: the signal first, then SIGKILL for whatever is still
 * running after the grace period.
 *
 * Gradle's client can exit while a single-use daemon it started is still
 * compiling, so the whole group is waited on, not only the child.
 *
 * @param {number} pgid - The group's id.
 * @param {NodeJS.Signals} signal - The signal to stop it with.
 * @returns {Promise<void>} Settles once the group is empty.
 */
async function stopGroup(pgid, signal) {
  signalGroup(pgid, signal);
  const deadline = Date.now() + GRACE_MS;
  while (groupAlive(pgid)) {
    if (Date.now() >= deadline) {
      log(`The build did not stop within ${String(GRACE_MS / 1000)} s; killing it.`);
      signalGroup(pgid, 'SIGKILL');
      break;
    }
    await new Promise((settle) => {
      setTimeout(settle, 250);
    });
  }
}

/**
 * Handles SIGINT and SIGTERM.
 *
 * Node's default handlers exit at once, which would skip the `finally` that
 * puts `app.json` back. So the signal is recorded and forwarded to the running
 * child's process group, and the run unwinds normally once that group is gone.
 * The children run in a group of their own, so a terminal's Ctrl-C reaches only
 * this process and is forwarded exactly once.
 *
 * @param {NodeJS.Signals} signal - The signal received.
 */
function onSignal(signal) {
  if (state.signal !== undefined) {
    return;
  }
  state.signal = signal;
  log(`Received ${signal}; stopping.`);
  const pid = state.child?.pid;
  if (pid !== undefined) {
    state.stopping = stopGroup(pid, signal);
  }
}

process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);

/**
 * Runs a short command to completion and returns what it printed.
 *
 * @param {string} command - The executable.
 * @param {string[]} args - Its arguments, never passed through a shell.
 * @param {{ env?: NodeJS.ProcessEnv, cwd?: string, binary?: boolean }} [options] -
 *   The environment and directory to run in, and whether to return raw bytes.
 * @returns {string | Buffer} Its stdout.
 */
function run(command, args, { env = sanitizedEnvironment(), cwd = ROOT, binary = false } = {}) {
  checkpoint();
  try {
    return execFileSync(command, args, {
      cwd,
      env,
      encoding: binary ? 'buffer' : 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const detail = String(error.stderr ?? '').trim() || error.message;
    throw new Error(`${command.split(sep).at(-1)} ${args[0]} failed:\n${detail}`, {
      cause: error,
    });
  } finally {
    checkpoint();
  }
}

/**
 * Runs a short command whose failure is an answer rather than an error.
 *
 * @param {string} command - The executable.
 * @param {string[]} args - Its arguments.
 * @returns {string | undefined} Its stdout, or `undefined` when it failed.
 */
function tryRun(command, args) {
  try {
    return String(run(command, args));
  } catch (error) {
    if (error instanceof InterruptedError) {
      throw error;
    }
    return undefined;
  }
}

/**
 * Runs a long command in its own process group, with its output on stderr.
 *
 * Asynchronous rather than `execFileSync`: a synchronous child blocks the event
 * loop, and the signal handlers could not run until it finished.
 *
 * @param {string} label - What the step is, for the log.
 * @param {string} command - The executable.
 * @param {string[]} args - Its arguments, never passed through a shell.
 * @param {{ env: NodeJS.ProcessEnv, cwd: string }} options - Where and how to run it.
 * @returns {Promise<void>} Settles when the command succeeded.
 */
function runLong(label, command, args, { env, cwd }) {
  checkpoint();
  const started = Date.now();
  log(`${label}...`);
  return new Promise((settle, fail) => {
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 2, 2] });
    state.child = child;
    child.once('error', (error) => {
      state.child = undefined;
      fail(error);
    });
    child.once('exit', (code, signal) => {
      state.child = undefined;
      const seconds = String(Math.round((Date.now() - started) / 1000));
      if (state.signal !== undefined) {
        const stopping = state.stopping ?? Promise.resolve();
        stopping.then(() => {
          fail(new InterruptedError(state.signal));
        }, fail);
      } else if (code === 0) {
        log(`${label} finished in ${seconds} s.`);
        settle();
      } else {
        fail(
          new Error(`${label} failed after ${seconds} s (${signal ?? `exit ${String(code)}`}).`),
        );
      }
    });
  });
}

/**
 * Reads the command line and the environment.
 *
 * @returns {{ reference?: string, out: string, abi?: string, versionCode?: string, keystore: string }}
 *   The reference APK (absent with `--self-reference`), the output path, the
 *   ABIs to build, the versionCode `--self-reference` expects, and the keystore.
 */
function parseOptions() {
  if (process.platform === 'win32') {
    throw new UsageError('Run this on Linux or macOS: gradlew and apksigner are shell scripts.');
  }
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        reference: { type: 'string' },
        'self-reference': { type: 'boolean' },
        out: { type: 'string' },
        abi: { type: 'string' },
      },
      strict: true,
    }));
  } catch (error) {
    throw new UsageError(error.message);
  }

  const selfReference = values['self-reference'] === true;
  if ((values.reference === undefined) === !selfReference) {
    throw new UsageError('Pass exactly one of --reference <standard.apk> and --self-reference.');
  }
  if (values.out === undefined || values.out === '') {
    throw new UsageError('Pass --out <sms.apk>.');
  }
  const out = resolve(values.out);
  if (!relative(ANDROID_DIR, out).startsWith('..')) {
    throw new UsageError('--out must be outside android/, which prebuild deletes.');
  }

  let reference;
  if (values.reference !== undefined) {
    reference = resolve(values.reference);
    if (!existsSync(reference)) {
      throw new UsageError(`--reference ${values.reference} does not exist.`);
    }
    if (reference === out) {
      throw new UsageError('--out must not be the reference APK.');
    }
  }

  const abis = values.abi?.split(',');
  if (abis !== undefined && !abis.every((abi) => ABIS.includes(abi))) {
    throw new UsageError(`--abi takes a comma-separated list of ${ABIS.join(', ')}.`);
  }

  const missing = REQUIRED_ENV.filter((name) => (process.env[name] ?? '') === '');
  if (selfReference && (process.env.ANDROID_VERSION_CODE ?? '') === '') {
    missing.push('ANDROID_VERSION_CODE');
  }
  if (missing.length > 0) {
    throw new UsageError(`Set ${missing.join(', ')}.`);
  }
  const keystore = resolve(process.env.ANDROID_KEYSTORE_PATH);
  if (!existsSync(keystore)) {
    throw new UsageError('ANDROID_KEYSTORE_PATH does not name a file.');
  }

  return {
    reference,
    out,
    abi: abis?.join(','),
    versionCode: selfReference ? process.env.ANDROID_VERSION_CODE : undefined,
    keystore,
  };
}

/**
 * Finds the SDK tools of the build-tools version React Native builds with, so
 * the APK is signed and checked by the same tools that built it.
 *
 * @returns {{ aapt2: string, apksigner: string, zipalign: string, keytool: string }}
 *   Each tool's path.
 */
function locateTools() {
  const versions = readFileSync(
    join(dirname(require.resolve('react-native/package.json')), 'gradle', 'libs.versions.toml'),
    'utf8',
  );
  const buildTools = /^buildTools\s*=\s*"([^"]+)"/mu.exec(versions)?.[1];
  if (buildTools === undefined) {
    throw new Error("Could not read buildTools from react-native's libs.versions.toml.");
  }
  const directory = join(process.env.ANDROID_HOME, 'build-tools', buildTools);
  const tools = {
    aapt2: join(directory, 'aapt2'),
    apksigner: join(directory, 'apksigner'),
    zipalign: join(directory, 'zipalign'),
  };
  if (!Object.values(tools).every((tool) => existsSync(tool))) {
    throw new UsageError(
      `Android build-tools ${buildTools} is not installed under ANDROID_HOME: ` +
        `sdkmanager "build-tools;${buildTools}"`,
    );
  }
  const javaKeytool =
    process.env.JAVA_HOME === undefined ? undefined : join(process.env.JAVA_HOME, 'bin', 'keytool');
  return {
    ...tools,
    keytool: javaKeytool !== undefined && existsSync(javaKeytool) ? javaKeytool : 'keytool',
  };
}

/**
 * The environment prebuild, Gradle and the config tools run in.
 *
 * It carries the build flag and the versionCode, and not the passwords:
 * Gradle runs third-party plugin code, and none of it needs them.
 * `ANDROID_NDK_HOME` is removed so the NDK is the one React Native pins with
 * `ndkVersion`, found under `ANDROID_HOME`, and not whichever one a machine's
 * variable happens to point at.
 *
 * @param {string} versionCode - The versionCode to build with.
 * @returns {NodeJS.ProcessEnv} The environment.
 */
function buildEnvironment(versionCode) {
  const env = sanitizedEnvironment();
  Reflect.deleteProperty(env, 'ANDROID_NDK_HOME');
  return {
    ...env,
    OTP_SMS_AUTOREAD: '1',
    ANDROID_VERSION_CODE: versionCode,
    EXPO_NO_GIT_STATUS: '1',
    CI: '1',
  };
}

/**
 * Resolves the public app config the build will use.
 *
 * @param {NodeJS.ProcessEnv} env - The build environment.
 * @returns {object} The resolved config.
 */
function resolveConfig(env) {
  checkpoint();
  try {
    return JSON.parse(
      execFileSync(
        process.execPath,
        [require.resolve('expo/bin/cli'), 'config', '--type', 'public', '--json'],
        { cwd: ROOT, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      ),
    );
  } catch (error) {
    const stderr = String(error.stderr ?? '');
    const refusal = /ANDROID_VERSION_CODE must be [^\n]*/u.exec(stderr)?.[0];
    if (refusal !== undefined) {
      throw new UsageError(refusal);
    }
    throw new Error(`Could not resolve the app config:\n${stderr.trim() || error.message}`, {
      cause: error,
    });
  } finally {
    checkpoint();
  }
}

/**
 * The runtime version the update tooling computes for this build's config.
 *
 * @param {NodeJS.ProcessEnv} env - The build environment.
 * @returns {string} The fingerprint hash.
 */
function resolveRuntime(env) {
  const output = run(
    process.execPath,
    [require.resolve('expo-updates/bin/cli'), 'runtimeversion:resolve', '--platform', 'android'],
    { env },
  );
  return JSON.parse(output).runtimeVersion;
}

/**
 * The SHA-256 digest of the certificate a keystore signs with.
 *
 * @param {string} keytool - The `keytool` executable.
 * @param {string} keystore - The keystore.
 * @returns {string} The digest, lowercase hex.
 */
function keystoreDigest(keytool, keystore) {
  const certificate = run(
    keytool,
    [
      '-exportcert',
      '-keystore',
      keystore,
      '-alias',
      process.env.ANDROID_KEY_ALIAS,
      '-storepass:env',
      'ANDROID_KEYSTORE_PASSWORD',
    ],
    { binary: true, env: signingEnvironment() },
  );
  return createHash('sha256').update(certificate).digest('hex');
}

/**
 * The package, versionCode and versionName an APK declares.
 *
 * @param {string} aapt2 - The `aapt2` executable.
 * @param {string} apk - The APK.
 * @returns {{ package: string, versionCode: string, versionName: string }} Its identity.
 */
function badging(aapt2, apk) {
  const output = run(aapt2, ['dump', 'badging', apk]);
  const match = /^package: name='([^']*)' versionCode='([^']*)' versionName='([^']*)'/mu.exec(
    output,
  );
  if (match === null) {
    throw new Error(`aapt2 printed no package line for ${apk}.`);
  }
  return { package: match[1], versionCode: match[2], versionName: match[3] };
}

/**
 * Verifies an APK's certificate and complete signing-scheme profile.
 *
 * @param {string} apksigner - The `apksigner` executable.
 * @param {string} apk - The APK.
 * @returns {ReturnType<typeof parseApkSignatureProfile> | undefined} Its profile,
 *   or `undefined` when the signature does not verify.
 */
function signatureProfile(apksigner, apk) {
  const output = tryRun(apksigner, ['verify', '--verbose', '--print-certs', apk]);
  return output === undefined ? undefined : parseApkSignatureProfile(output);
}

/**
 * Decodes one attribute value from `aapt2 dump xmltree`.
 *
 * A string prints as `"value" (Raw: "value")` with the value's own quotes left
 * unescaped, so the value's length is recovered from the line's length rather
 * than by searching for a quote. Booleans, numbers and resource references
 * print bare.
 *
 * @param {string} text - Everything after the attribute's `=`.
 * @returns {string} The value.
 */
function attributeValue(text) {
  if (!text.startsWith('"')) {
    return text;
  }
  const length = (text.length - '"" (Raw: "")'.length) / 2;
  const value = text.slice(1, 1 + length);
  if (text === `"${value}" (Raw: "${value}")`) {
    return value;
  }
  return text.endsWith('"') ? text.slice(1, -1) : text;
}

/**
 * Parses `aapt2 dump xmltree` output into a tree of elements.
 *
 * @param {string} text - The dump.
 * @returns {{ name: string, attributes: Record<string, string>, children: object[] }}
 *   The root, whose children are the document's top-level elements.
 */
function parseXmlTree(text) {
  const root = { name: '', attributes: {}, children: [], indent: -1 };
  const stack = [root];
  for (const line of text.split('\n')) {
    const element = /^(\s*)E: (\S+) \(line=\d+\)$/u.exec(line);
    if (element !== null) {
      const indent = element[1].length;
      while (stack.at(-1).indent >= indent) {
        stack.pop();
      }
      const node = { name: element[2], attributes: {}, children: [], indent };
      stack.at(-1).children.push(node);
      stack.push(node);
      continue;
    }
    const attribute =
      /^\s*A: (?:http:\/\/schemas\.android\.com\/apk\/res\/android:)?([\w-]+)(?:\(0x[0-9a-f]+\))?=(.*)$/u.exec(
        line,
      );
    if (attribute !== null) {
      stack.at(-1).attributes[attribute[1]] = attributeValue(attribute[2]);
    }
  }
  return root;
}

/**
 * Every element of one name below a node, at any depth.
 *
 * @param {{ name: string, children: object[] }} node - Where to look.
 * @param {string} name - The element name.
 * @returns {object[]} The matches, in document order.
 */
function descendants(node, name) {
  return node.children.flatMap((child) => [
    ...(child.name === name ? [child] : []),
    ...descendants(child, name),
  ]);
}

/**
 * The direct children of one name.
 *
 * @param {{ children: object[] }} node - The parent.
 * @param {string} name - The element name.
 * @param {string} [androidName] - Keep only those with this `android:name`.
 * @returns {object[]} The matches, in document order.
 */
function children(node, name, androidName) {
  return node.children.filter(
    (child) =>
      child.name === name && (androidName === undefined || child.attributes.name === androidName),
  );
}

/**
 * Whether a string is JSON naming exactly the SMS channel.
 *
 * @param {string | undefined} value - The meta's value.
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

/**
 * Checks the merged manifest: the permission, what runs on it, and the update
 * wiring.
 *
 * @param {string} xmltree - `aapt2 dump xmltree` of `AndroidManifest.xml`.
 * @param {string} updateUrl - The URL the app must fetch updates from.
 * @param {(condition: boolean, failure: string) => void} check - Records a failure.
 */
function checkManifest(xmltree, updateUrl, check) {
  const manifest = children(parseXmlTree(xmltree), 'manifest')[0];
  const application = manifest === undefined ? undefined : children(manifest, 'application')[0];
  if (application === undefined) {
    check(false, 'manifest: no <application> element in the dump');
    return;
  }
  const permissions = [
    ...children(manifest, 'uses-permission'),
    ...children(manifest, 'uses-permission-sdk-23'),
  ].map((entry) => entry.attributes.name);
  check(permissions.includes(RECEIVE_SMS), `permission: ${RECEIVE_SMS} is not requested`);
  check(!permissions.includes(READ_SMS), `permission: ${READ_SMS} is requested`);

  const receivers = children(application, 'receiver', RECEIVER);
  const receiver = receivers[0];
  check(
    receivers.length === 1 &&
      receiver.attributes.exported === 'true' &&
      receiver.attributes.permission === BROADCAST_SMS &&
      descendants(receiver, 'action').some((action) => action.attributes.name === SMS_RECEIVED),
    `receiver: ${RECEIVER} is not declared once, exported, guarded by ${BROADCAST_SMS} and listening for ${SMS_RECEIVED}`,
  );
  const services = children(application, 'service', SERVICE);
  check(
    services.length === 1 && services[0].attributes.exported === 'false',
    `service: ${SERVICE} is not declared once and unexported`,
  );

  /**
   * The value of every application-level meta of one name.
   *
   * @param {string} name - The meta's `android:name`.
   * @returns {(string | undefined)[]} Each value, in order.
   */
  const meta = (name) =>
    children(application, 'meta-data', name).map((entry) => entry.attributes.value);
  const headers = meta(REQUEST_HEADERS_META);
  check(
    headers.length === 1 && namesAutoReadChannel(headers[0]),
    `channel: ${REQUEST_HEADERS_META} is ${JSON.stringify(headers)}, not once {"expo-channel-name":"${AUTO_READ_CHANNEL}"}`,
  );
  const urls = meta(UPDATE_URL_META);
  check(
    urls.length === 1 && urls[0] === updateUrl,
    `updateUrl: ${UPDATE_URL_META} is ${JSON.stringify(urls)}, not ${updateUrl}`,
  );
  check(
    !meta(ENABLED_META).includes('false'),
    `enabled: ${ENABLED_META} is false, so the app would never update`,
  );
}

/**
 * Reads what the built APK must match from the standard APK of the release.
 *
 * @param {ReturnType<typeof locateTools>} tools - The SDK tools.
 * @param {string} apk - The reference APK.
 * @returns {{
 *   package: string,
 *   versionCode: string,
 *   versionName: string,
 *   signer: string,
 *   schemes: Record<string, boolean>
 * }} Its identity and complete signing profile.
 */
function readReference(tools, apk) {
  const identity = badging(tools.aapt2, apk);
  const profile = signatureProfile(tools.apksigner, apk);
  if (profile === undefined || profile.signers.length !== 1) {
    throw new InvariantError([
      `reference: ${apk} has ${String(profile?.signers.length ?? 0)} verified signers, not 1`,
    ]);
  }
  try {
    signingSchemeArguments(profile.schemes);
  } catch (error) {
    throw new InvariantError([
      `referenceSignature: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
  return { ...identity, signer: profile.signers[0], schemes: profile.schemes };
}

/**
 * Checks, before the long build, what can already be known to be wrong: the
 * app config against the reference, the keystore against its signer, and an
 * `updates.url` pointing somewhere else.
 *
 * @param {{ package: string, versionName: string, signer: string }} expected -
 *   What the APK must match.
 * @param {{ config: object, keystore: string, url?: string, derived: string }} actual -
 *   The resolved config, the keystore's digest, and the configured and derived
 *   update URLs.
 */
function preflight(expected, { config, keystore, url, derived }) {
  const failures = [];
  if (config.android?.package !== expected.package) {
    failures.push(
      `package: the config builds ${String(config.android?.package)}, the reference is ${expected.package}`,
    );
  }
  if (config.version !== expected.versionName) {
    failures.push(
      `versionName: the config builds ${String(config.version)}, the reference is ${expected.versionName}`,
    );
  }
  if (keystore !== expected.signer) {
    failures.push(`signer: the keystore signs as ${keystore}, the reference as ${expected.signer}`);
  }
  if (url !== undefined && url !== derived) {
    failures.push(`updateUrl: app.json has ${url}, but this project's updates are at ${derived}`);
  }
  if (failures.length > 0) {
    throw new InvariantError(failures);
  }
}

/**
 * Checks the signed APK against every invariant, and lists each that fails.
 *
 * @param {string} apk - The signed APK.
 * @param {ReturnType<typeof readReference>} expected - What it must match.
 * @param {{ runtime: string, updateUrl: string }} build - The runtime and update
 *   URL it was built with.
 * @param {ReturnType<typeof locateTools>} tools - The SDK tools.
 * @returns {string} The verified signer's digest.
 */
function inspect(apk, expected, build, tools) {
  const failures = [];
  /**
   * Records a failure unless the condition holds.
   *
   * @param {boolean} condition - What must be true.
   * @param {string} failure - The invariant's name and what went wrong.
   */
  const check = (condition, failure) => {
    if (!condition) {
      failures.push(failure);
    }
  };

  const identity = badging(tools.aapt2, apk);
  for (const field of ['package', 'versionCode', 'versionName']) {
    check(
      identity[field] === expected[field],
      `${field}: built ${identity[field]}, expected ${expected[field]}`,
    );
  }

  const profile = signatureProfile(tools.apksigner, apk);
  check(profile !== undefined, 'signature: apksigner could not verify the generated APK');
  if (profile !== undefined) {
    check(
      profile.signers.length === 1 && profile.signers[0] === expected.signer,
      `signer: verified signers are [${profile.signers.join(', ')}], expected exactly ${expected.signer}`,
    );
    check(
      sameSigningSchemes(expected.schemes, profile.schemes),
      `signatureProfile: generated ${describeSigningSchemes(
        profile.schemes,
      )}, expected ${describeSigningSchemes(expected.schemes)}`,
    );
  }

  checkManifest(
    run(tools.aapt2, ['dump', 'xmltree', '--file', 'AndroidManifest.xml', apk]),
    build.updateUrl,
    check,
  );

  const fingerprint = tryRun('unzip', ['-p', apk, 'assets/fingerprint'])?.trim();
  check(
    fingerprint === build.runtime,
    `runtime: assets/fingerprint is ${String(fingerprint)}, but its updates resolve ${build.runtime}`,
  );

  check(
    tryRun(tools.zipalign, ['-c', '-P', '16', '4', apk]) !== undefined,
    'alignment: zipalign -c -P 16 4 fails, so 16 KB-page devices cannot load it',
  );

  const leftovers = String(run('unzip', ['-Z1', apk]))
    .split('\n')
    .filter((entry) => V1_SIGNATURE_ENTRY.test(entry));
  check(
    leftovers.length > 0 === expected.schemes.v1,
    `v1Signature: archive entries are [${leftovers.join(
      ', ',
    )}], but the standard profile has v1=${String(expected.schemes.v1)}`,
  );

  if (failures.length > 0) {
    throw new InvariantError(failures);
  }
  return profile.signers[0];
}

/**
 * Puts a file back to the bytes it had, when they have changed.
 *
 * @param {string} file - The file.
 * @param {Buffer} bytes - Its original contents.
 */
function restore(file, bytes) {
  if (!readFileSync(file).equals(bytes)) {
    writeFileSync(file, bytes);
  }
}

/**
 * Builds, signs and checks the APK.
 *
 * @param {ReturnType<typeof parseOptions>} options - The parsed options.
 * @returns {Promise<object>} The summary printed on success.
 */
async function main(options) {
  const tools = locateTools();
  const reference =
    options.reference === undefined ? undefined : readReference(tools, options.reference);
  const versionCode = reference?.versionCode ?? options.versionCode;
  const env = buildEnvironment(versionCode);
  const config = resolveConfig(env);
  const keystore = keystoreDigest(tools.keytool, options.keystore);
  const expected = reference ?? {
    package: config.android?.package,
    versionCode,
    versionName: config.version,
    signer: keystore,
    schemes: SELF_REFERENCE_SCHEMES,
  };

  const original = readFileSync(APP_JSON);
  const originalPackage = readFileSync(PACKAGE_JSON);
  const appJson = JSON.parse(original.toString('utf8'));
  const projectId = appJson.expo?.extra?.eas?.projectId;
  if (typeof projectId !== 'string' || projectId === '') {
    throw new InvariantError([
      'updateUrl: app.json has no expo.extra.eas.projectId to derive it from',
    ]);
  }
  const updateUrl = { url: appJson.expo.updates?.url, derived: `https://u.expo.dev/${projectId}` };
  preflight(expected, { config, keystore, ...updateUrl });

  try {
    if (updateUrl.url === undefined) {
      appJson.expo.updates = { ...appJson.expo.updates, url: updateUrl.derived };
      writeFileSync(APP_JSON, `${JSON.stringify(appJson, null, 2)}\n`);
    }
    // Resolved before prebuild, from the same inputs the update publish sees:
    // a runner that publishes updates has no android/ folder.
    const runtime = resolveRuntime(env);

    await runLong(
      'expo prebuild',
      process.execPath,
      [
        require.resolve('expo/bin/cli'),
        'prebuild',
        '--platform',
        'android',
        '--clean',
        '--no-install',
      ],
      { env, cwd: ROOT },
    );
    const afterPrebuild = resolveRuntime(env);
    if (afterPrebuild !== runtime) {
      throw new InvariantError([
        `runtime: ${runtime} before prebuild but ${afterPrebuild} after it, so updates would not match`,
      ]);
    }
    await runLong(
      'gradle assembleRelease',
      join(ANDROID_DIR, 'gradlew'),
      [
        'assembleRelease',
        '--no-daemon',
        '--console=plain',
        ...(options.abi === undefined ? [] : [`-PreactNativeArchitectures=${options.abi}`]),
      ],
      // Left alone, Gradle embeds a runtime it hashes mid-build, when Kotlin
      // session files under node_modules are part of it. EAS Build hands
      // Gradle the runtime it resolved instead, and so does this.
      { env: { ...env, EXPO_UPDATES_FINGERPRINT_OVERRIDE: runtime }, cwd: ANDROID_DIR },
    );

    mkdirSync(dirname(options.out), { recursive: true });
    run(
      tools.apksigner,
      [
        'sign',
        '--ks',
        options.keystore,
        '--ks-key-alias',
        process.env.ANDROID_KEY_ALIAS,
        '--ks-pass',
        'env:ANDROID_KEYSTORE_PASSWORD',
        '--key-pass',
        'env:ANDROID_KEY_PASSWORD',
        // apksigner's defaults depend on SDK bounds. Explicit switches keep the
        // generated artifact's profile equal to the standard release APK.
        ...signingSchemeArguments(expected.schemes),
        '--out',
        options.out,
        BUILT_APK,
      ],
      { env: signingEnvironment() },
    );

    const signer = inspect(options.out, expected, { runtime, updateUrl: updateUrl.derived }, tools);
    return {
      versionCode: Number(expected.versionCode),
      versionName: expected.versionName,
      runtime,
      signerSha256: signer,
      updateUrl: updateUrl.url === undefined ? 'derived' : 'configured',
    };
  } finally {
    restore(APP_JSON, original);
    restore(PACKAGE_JSON, originalPackage);
    rmSync(BUILT_APK, { force: true });
    rmSync(ANDROID_DIR, { recursive: true, force: true });
  }
}

/**
 * Reports a failure on stderr.
 *
 * @param {unknown} error - What stopped the run.
 * @returns {number} The exit status.
 */
function report(error) {
  if (state.signal !== undefined) {
    log(
      `Stopped by ${state.signal}; app.json and package.json are as they were, and any generated android/ was removed.`,
    );
    return 128 + constants.signals[state.signal];
  }
  if (error instanceof UsageError) {
    log(error.message);
    log(
      'Usage: node scripts/build-sms-apk.mjs (--reference <standard.apk> | --self-reference) --out <sms.apk> [--abi x86_64]',
    );
    return 2;
  }
  if (error instanceof InvariantError) {
    log(
      `The SMS APK does not match what it must pair with:\n${error.failures
        .map((failure) => `  - ${failure}`)
        .join('\n')}`,
    );
    return 1;
  }
  log(error instanceof Error ? error.message : String(error));
  return 1;
}

let options;
try {
  options = parseOptions();
  checkpoint();
  const summary = await main(options);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} catch (error) {
  const status = report(error);
  if (status !== 2 && options !== undefined) {
    rmSync(options.out, { force: true });
  }
  process.exitCode = status;
}
