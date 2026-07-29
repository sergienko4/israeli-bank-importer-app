/**
 * Detects a newer installable build on GitHub Releases.
 *
 * Over-the-air updates carry JavaScript changes, but a release that touches
 * native code ships a new binary that no update can deliver. This app is
 * sideloaded rather than installed from a store, so nothing would otherwise
 * tell the user that binary exists. This module asks the public Releases API
 * and returns the download link when the running version is behind.
 *
 * Every failure path — offline, rate limited, malformed payload, timeout —
 * resolves to "no update" rather than throwing. A background version check is
 * never worth interrupting the user for.
 */
const REPO_SLUG = 'sergienko4/israeli-bank-importer-app';
const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO_SLUG}/releases/latest`;

/**
 * Only a URL with this exact prefix is ever handed to the browser. The release
 * payload is untrusted input, so an allowlist is used rather than parsing the
 * host: an asset pointing somewhere else is simply ignored.
 */
const DOWNLOAD_URL_PREFIX = `https://github.com/${REPO_SLUG}/releases/download/`;

const REQUEST_TIMEOUT_MS = 8_000;

/** Matches the trailing `major.minor.patch` of a tag or a version string. */
const VERSION_PATTERN = /(\d+)\.(\d+)\.(\d+)$/;

/** A newer installable build published on GitHub Releases. */
export interface AvailableRelease {
  /** The released version, without any tag prefix (for example `0.3.0`). */
  readonly version: string;
  /** The verified GitHub download URL of the Android package. */
  readonly downloadUrl: string;
}

/**
 * Extracts the numeric version from a release tag or a version string.
 * @param value - A tag such as `israeli-bank-importer-app-v0.3.0`, or `0.3.0`.
 * @returns The major, minor, and patch numbers, or null when absent.
 */
function parseVersion(value: string): [number, number, number] | null {
  const match = VERSION_PATTERN.exec(value);
  if (match === null) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Normalises a release tag to a bare `major.minor.patch` string.
 * @param value - A release tag or version string.
 * @returns The bare version, or null when the value carries none.
 */
export function normalizeVersion(value: string): string | null {
  const match = VERSION_PATTERN.exec(value);
  return match === null ? null : match[0];
}

/**
 * Compares two versions. An unparseable value is treated as "not newer", so a
 * malformed tag can never nag the user into a download.
 * @param candidate - The version offered by the release.
 * @param current - The version the app is running.
 * @returns True when the candidate is strictly newer.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate);
  const now = parseVersion(current);
  if (next === null || now === null) {
    return false;
  }
  for (let part = 0; part < next.length; part += 1) {
    if (next[part] !== now[part]) {
      return next[part] > now[part];
    }
  }
  return false;
}

/**
 * Reads a string property from an untrusted value.
 * @param source - The value to read from.
 * @param key - The property name.
 * @returns The string value, or null when missing or of another type.
 */
function readString(source: unknown, key: string): string | null {
  if (typeof source !== 'object' || source === null) {
    return null;
  }
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

/**
 * Finds the Android package among a release's assets, rejecting any download
 * URL that does not sit under this repository's releases.
 * @param assets - The untrusted `assets` array from the release payload.
 * @returns The verified download URL, or null when there is none.
 */
export function findApkDownloadUrl(assets: unknown): string | null {
  if (!Array.isArray(assets)) {
    return null;
  }
  const entries = assets as unknown[];
  for (const asset of entries) {
    const url = readString(asset, 'browser_download_url');
    if (url !== null && url.startsWith(DOWNLOAD_URL_PREFIX) && url.endsWith('.apk')) {
      return url;
    }
  }
  return null;
}

/**
 * Asks GitHub for the latest release and reports it when it is newer than the
 * running version and ships a downloadable Android package.
 * @param currentVersion - The version the app is running.
 * @returns The newer release, or null when there is nothing to offer.
 */
export async function fetchLatestRelease(currentVersion: string): Promise<AvailableRelease | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(LATEST_RELEASE_URL, {
      headers: { accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as { tag_name?: unknown; assets?: unknown };
    return toAvailableRelease(data, currentVersion);
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Validates a release payload against the running version.
 * @param data - The untrusted release payload.
 * @param currentVersion - The version the app is running.
 * @returns The newer release, or null when it is not usable.
 */
function toAvailableRelease(
  data: { tag_name?: unknown; assets?: unknown },
  currentVersion: string,
): AvailableRelease | null {
  const tag = typeof data.tag_name === 'string' ? data.tag_name : '';
  const version = normalizeVersion(tag);
  if (version === null || !isNewerVersion(version, currentVersion)) {
    return null;
  }
  const downloadUrl = findApkDownloadUrl(data.assets);
  return downloadUrl === null ? null : { version, downloadUrl };
}
