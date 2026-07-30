/**
 * PKCE material for the portal's browser sign-in.
 *
 * The app is a public client: it ships to phones, so it cannot hold a secret
 * that proves the token request came from the same install that started the
 * sign-in. PKCE replaces that secret with a value invented per attempt — the
 * browser only ever carries its hash, so intercepting the redirect is not
 * enough to redeem the code.
 *
 * Base64url is encoded here by hand rather than through `btoa`, which React
 * Native does not guarantee, and rather than a regex rewrite, which would scan
 * attacker-influenced text. The loop is linear and ASCII-only.
 */
import * as Crypto from 'expo-crypto';

/** Verifier entropy. 32 bytes encodes to the 43 characters the RFC allows. */
const VERIFIER_BYTES = 32;

/** State entropy. 16 bytes encodes to 22 characters. */
const STATE_BYTES = 16;

/** Base64url alphabet: standard base64 with `-` and `_` in the last two slots. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** A PKCE verifier and its S256 challenge. */
export interface PkcePair {
  verifier: string;
  challenge: string;
}

/**
 * Encodes up to three bytes as the base64url characters they fill.
 *
 * A short final group produces two or three characters rather than four; the
 * padding a standard encoder would add is exactly what base64url omits.
 * @param bytes - The full byte array.
 * @param offset - Index of the first byte in this group.
 * @returns Two, three, or four base64url characters.
 */
function encodeGroup(bytes: Uint8Array, offset: number): string {
  const remaining = bytes.length - offset;
  const first = bytes[offset];
  const second = remaining > 1 ? bytes[offset + 1] : 0;
  const third = remaining > 2 ? bytes[offset + 2] : 0;
  const word = (first << 16) | (second << 8) | third;
  const chars = [
    ALPHABET[(word >> 18) & 63],
    ALPHABET[(word >> 12) & 63],
    ALPHABET[(word >> 6) & 63],
    ALPHABET[word & 63],
  ];
  return chars.slice(0, Math.min(remaining + 1, 4)).join('');
}

/**
 * Encodes bytes as unpadded base64url.
 * @param bytes - The bytes to encode.
 * @returns A string containing only `A-Z`, `a-z`, `0-9`, `-`, and `_`.
 */
function encodeBase64Url(bytes: Uint8Array): string {
  let encoded = '';
  for (let offset = 0; offset < bytes.length; offset += 3) {
    encoded += encodeGroup(bytes, offset);
  }
  return encoded;
}

/**
 * Rewrites standard base64 as base64url.
 *
 * `digestStringAsync` only offers hex or standard base64, and hex would be too
 * long for the challenge parameter.
 * @param base64 - Standard base64, possibly padded.
 * @returns The same value in unpadded base64url.
 */
function toBase64Url(base64: string): string {
  let converted = '';
  for (const char of base64) {
    if (char === '=') {
      continue;
    }
    if (char === '+') {
      converted += '-';
    } else if (char === '/') {
      converted += '_';
    } else {
      converted += char;
    }
  }
  return converted;
}

/**
 * Creates a PKCE verifier and its S256 challenge.
 *
 * The verifier must stay in memory for the length of one sign-in and must never
 * be logged or persisted: it is the only proof that the app that redeems the
 * code is the app that asked for it.
 * @returns A fresh verifier and the challenge derived from it.
 */
export async function createPkcePair(): Promise<PkcePair> {
  const bytes = await Crypto.getRandomBytesAsync(VERIFIER_BYTES);
  const verifier = encodeBase64Url(bytes);
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  return { verifier, challenge: toBase64Url(digest) };
}

/**
 * Creates an opaque CSRF state value for the authorization request.
 *
 * The portal echoes it back untouched, so a redirect that arrives with a
 * different state did not come from the sign-in this app started.
 * @returns A 22-character base64url string.
 */
export async function createState(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(STATE_BYTES);
  return encodeBase64Url(bytes);
}
