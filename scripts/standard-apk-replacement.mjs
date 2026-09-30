/**
 * Withdraws and restores the privileged SMS asset around standard APK replacement.
 *
 * GitHub CLI deletes an existing asset before a `--clobber` upload. The SMS
 * asset must therefore be absent before the standard asset can disappear, or
 * clients that select the first APK can observe the privileged variant.
 *
 * Usage:
 *   node scripts/standard-apk-replacement.mjs --prepare
 *   node scripts/standard-apk-replacement.mjs --restore
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/** The privileged release asset preserved around standard replacement. */
const SMS_APK_ASSET = 'israeli-bank-importer.sms.apk';

/** The private runner directory holding a withdrawn asset. */
const BACKUP_DIRECTORY = 'release-asset-backup';

/**
 * Validates and withdraws the SMS asset only after preserving every byte.
 *
 * @param {unknown} release - The untrusted GitHub release response.
 * @param {{
 *   downloadAsset: (asset: { id: number, name: string, size: number }) => Buffer,
 *   writeBackup: (contents: Buffer) => void,
 *   deleteAsset: (asset: { id: number, name: string, size: number }) => void
 * }} operations - The side effects, injected so failure ordering is testable.
 * @returns {boolean} `true` when an SMS asset was preserved and withdrawn.
 * @throws {Error} The response is malformed, ambiguous, or the backup is incomplete.
 */
export function prepareStandardApkReplacement(release, operations) {
  if (typeof release !== 'object' || release === null || !Array.isArray(release.assets)) {
    throw new Error('GitHub returned no release assets array.');
  }
  const matches = release.assets.filter(
    (asset) => typeof asset === 'object' && asset !== null && asset.name === SMS_APK_ASSET,
  );
  if (matches.length === 0) {
    return false;
  }
  if (matches.length !== 1) {
    throw new Error(`GitHub returned ${String(matches.length)} SMS assets, not one.`);
  }
  const asset = matches[0];
  if (
    !Number.isSafeInteger(asset.id) ||
    asset.id <= 0 ||
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0
  ) {
    throw new Error('The SMS asset has an invalid id or size.');
  }
  const normalized = { id: asset.id, name: SMS_APK_ASSET, size: asset.size };
  const contents = operations.downloadAsset(normalized);
  if (!Buffer.isBuffer(contents) || contents.length !== normalized.size) {
    throw new Error(
      `The SMS backup is ${String(contents?.length ?? 0)} bytes, expected ${String(
        normalized.size,
      )}.`,
    );
  }
  operations.writeBackup(contents);
  operations.deleteAsset(normalized);
  return true;
}

/**
 * Reads one required workflow environment variable.
 *
 * @param {string} name - The variable name.
 * @param {string | undefined} value - Its current value.
 * @returns {string} Its non-empty value.
 * @throws {Error} The variable is absent.
 */
function requiredEnvironment(name, value) {
  if (value === undefined || value === '') {
    throw new Error(`${name} is required.`);
  }
  return value;
}

/**
 * Runs GitHub CLI without a shell.
 *
 * @param {string[]} args - The exact arguments.
 * @param {boolean} [binary=false] - Whether stdout is binary.
 * @returns {string | Buffer} Captured stdout.
 */
function runGh(args, binary = false) {
  return execFileSync('gh', args, {
    encoding: binary ? null : 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Resolves the private backup path under the runner's temporary directory.
 *
 * @param {string} runnerTemp - The trusted GitHub runner temp directory.
 * @returns {string} The exact SMS backup path.
 */
function backupPath(runnerTemp) {
  return join(runnerTemp, BACKUP_DIRECTORY, SMS_APK_ASSET);
}

/**
 * Appends one simple output to the current GitHub Actions step.
 *
 * @param {string} output - The GitHub output file.
 * @param {string} name - The output name.
 * @param {string} value - A newline-free trusted value.
 */
function writeOutput(output, name, value) {
  appendFileSync(output, `${name}=${value}\n`);
}

/**
 * Preserves and withdraws the SMS asset before standard replacement.
 */
function prepare() {
  const repository = requiredEnvironment('GITHUB_REPOSITORY', process.env.GITHUB_REPOSITORY);
  const tag = requiredEnvironment('RELEASE_TAG', process.env.RELEASE_TAG);
  const runnerTemp = requiredEnvironment('RUNNER_TEMP', process.env.RUNNER_TEMP);
  const output = requiredEnvironment('GITHUB_OUTPUT', process.env.GITHUB_OUTPUT);
  if (!/^[\w.-]+\/[\w.-]+$/u.test(repository)) {
    throw new Error('GITHUB_REPOSITORY is not owner/name.');
  }
  const release = JSON.parse(runGh(['api', `repos/${repository}/releases/tags/${tag}`]));
  const path = backupPath(runnerTemp);
  const preserved = prepareStandardApkReplacement(release, {
    downloadAsset: (asset) =>
      runGh(
        [
          'api',
          '-H',
          'Accept: application/octet-stream',
          `repos/${repository}/releases/assets/${String(asset.id)}`,
        ],
        true,
      ),
    writeBackup: (contents) => {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, contents, { mode: 0o600 });
    },
    deleteAsset: (asset) => {
      runGh([
        'api',
        '--method',
        'DELETE',
        `repos/${repository}/releases/assets/${String(asset.id)}`,
      ]);
    },
  });
  writeOutput(output, 'restore_sms', String(preserved));
}

/**
 * Restores the preserved SMS asset after the standard upload succeeds.
 */
function restore() {
  const repository = requiredEnvironment('GITHUB_REPOSITORY', process.env.GITHUB_REPOSITORY);
  const tag = requiredEnvironment('RELEASE_TAG', process.env.RELEASE_TAG);
  const path = backupPath(requiredEnvironment('RUNNER_TEMP', process.env.RUNNER_TEMP));
  if (!existsSync(path) || readFileSync(path).length === 0) {
    throw new Error(`The preserved SMS APK is missing from ${dirname(path)}.`);
  }
  runGh(['release', 'upload', tag, path, '--repo', repository]);
  console.log(`Restored ${basename(path)} after the standard APK.`);
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && resolve(entryPoint) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: {
        prepare: { type: 'boolean' },
        restore: { type: 'boolean' },
      },
      strict: true,
    });
    if (values.prepare === values.restore) {
      throw new Error('Specify exactly one of --prepare or --restore.');
    }
    if (values.prepare) {
      prepare();
    } else {
      restore();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
