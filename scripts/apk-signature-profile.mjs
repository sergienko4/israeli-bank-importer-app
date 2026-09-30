/** APK signing schemes printed by build-tools 36 `apksigner verify --verbose`. */
const SCHEMES = ['v1', 'v2', 'v3', 'v3.1', 'v4'];

/** Errors proving that a verified APK has no signing-certificate lineage. */
const MISSING_LINEAGE_ERRORS = [
  'The provided APK does not contain a valid lineage.',
  'The provided APK does not contain a valid V3 nor V3.1 signature block.',
];

/**
 * Parses the verified certificate and signing-scheme profile of an APK.
 *
 * @param {string} output - `apksigner verify --verbose --print-certs` output.
 * @returns {{ signers: string[], schemes: Record<string, boolean> }} The verified profile.
 * @throws {Error} The output omits or duplicates a signing-scheme result.
 */
export function parseApkSignatureProfile(output) {
  const schemes = {};
  for (const match of output.matchAll(
    /^Verified using (v(?:1|2|3|3\.1|4)) scheme(?: [^:]*)?: (true|false)$/gmu,
  )) {
    const scheme = match[1];
    if (Object.hasOwn(schemes, scheme)) {
      throw new Error(`apksigner printed ${scheme} verification more than once.`);
    }
    schemes[scheme] = match[2] === 'true';
  }
  const missing = SCHEMES.filter((scheme) => !Object.hasOwn(schemes, scheme));
  if (missing.length > 0) {
    throw new Error(`apksigner printed no verification result for: ${missing.join(', ')}.`);
  }
  const signers = [
    ...output.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([0-9a-f]{64})$/gmu),
  ].map((match) => match[1]);
  return { signers, schemes };
}

/**
 * Reports whether two APKs use every signing scheme in the same way.
 *
 * @param {Record<string, boolean>} expected - The reference APK's schemes.
 * @param {Record<string, boolean>} actual - The generated APK's schemes.
 * @returns {boolean} `true` only when every verified scheme flag is equal.
 */
export function sameSigningSchemes(expected, actual) {
  return SCHEMES.every((scheme) => expected[scheme] === actual[scheme]);
}

/**
 * Distinguishes an APK without key rotation from a lineage-tool failure.
 *
 * @param {string} output - The stderr or wrapped error from `apksigner lineage`.
 * @returns {boolean} `true` only for Build Tools' two no-lineage outcomes.
 */
export function isMissingSigningLineageError(output) {
  const message = output.trim();
  return MISSING_LINEAGE_ERRORS.some((missing) => message.endsWith(missing));
}

/**
 * Converts a verified APK profile into explicit `apksigner sign` switches.
 *
 * APK Signature Scheme v3.1 is a rotated-key variant of v3 and has no separate
 * enable switch. This project uses one unrotated signer, so a v3.1 reference
 * cannot be reproduced safely.
 *
 * @param {Record<string, boolean>} schemes - The reference APK's verified schemes.
 * @returns {string[]} Explicit v1, v2, v3 and v4 signing arguments.
 * @throws {Error} The reference uses the unsupported v3.1 rotated-key scheme.
 */
export function signingSchemeArguments(schemes) {
  if (schemes['v3.1']) {
    throw new Error('The standard APK uses v3.1 signing, which requires a signing-key lineage.');
  }
  return ['v1', 'v2', 'v3', 'v4'].flatMap((scheme) => [
    `--${scheme}-signing-enabled`,
    String(schemes[scheme]),
  ]);
}

/**
 * Formats the scheme flags for one actionable invariant failure.
 *
 * @param {Record<string, boolean>} schemes - An APK's verified schemes.
 * @returns {string} Every scheme and its verified state.
 */
export function describeSigningSchemes(schemes) {
  return SCHEMES.map((scheme) => `${scheme}=${String(schemes[scheme])}`).join(', ');
}
