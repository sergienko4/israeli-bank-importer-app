/**
 * Compares the verified certificate and signing-scheme profiles of two APKs.
 *
 * Usage:
 *   node scripts/compare-apk-signatures.mjs \
 *     --apksigner <path> --reference <standard.apk> --actual <generated.apk>
 */

import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

import {
  describeSigningSchemes,
  parseApkSignatureProfile,
  sameSigningSchemes,
} from './apk-signature-profile.mjs';

/**
 * Returns a child-process environment without signing passwords.
 *
 * @returns {NodeJS.ProcessEnv} The password-free environment.
 */
function sanitizedEnvironment() {
  const signingPasswords = new Set(['ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_PASSWORD']);
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !signingPasswords.has(name)),
  );
}

/**
 * Reads one APK's verified signature profile.
 *
 * @param {string} apksigner - The Android SDK verifier.
 * @param {string} apk - The APK to inspect.
 * @returns {ReturnType<typeof parseApkSignatureProfile>} Its verified profile.
 */
function readProfile(apksigner, apk) {
  const output = execFileSync(apksigner, ['verify', '--verbose', '--print-certs', apk], {
    encoding: 'utf8',
    env: sanitizedEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return parseApkSignatureProfile(output);
}

const { values } = parseArgs({
  options: {
    apksigner: { type: 'string' },
    reference: { type: 'string' },
    actual: { type: 'string' },
  },
  strict: true,
});

for (const name of ['apksigner', 'reference', 'actual']) {
  if (values[name] === undefined || values[name] === '') {
    throw new Error(`--${name} is required.`);
  }
}

const expected = readProfile(values.apksigner, values.reference);
const actual = readProfile(values.apksigner, values.actual);
const failures = [];
if (
  expected.signers.length !== actual.signers.length ||
  expected.signers.some((signer, index) => signer !== actual.signers[index])
) {
  failures.push(
    `signers differ: expected [${expected.signers.join(', ')}], actual [${actual.signers.join(
      ', ',
    )}]`,
  );
}
if (!sameSigningSchemes(expected.schemes, actual.schemes)) {
  failures.push(
    `signing schemes differ: expected ${describeSigningSchemes(
      expected.schemes,
    )}, actual ${describeSigningSchemes(actual.schemes)}`,
  );
}
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `APK signatures match: ${expected.signers.length} signer, ${describeSigningSchemes(
      expected.schemes,
    )}.`,
  );
}
