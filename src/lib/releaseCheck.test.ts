import {
  apkAssetFor,
  type AvailableRelease,
  fetchLatestRelease,
  findApkDownloadUrl,
  isNewerVersion,
  normalizeVersion,
  SMS_APK_ASSET,
  STANDARD_APK_ASSET,
} from './releaseCheck';

const RELEASE_DOWNLOADS =
  'https://github.com/sergienko4/israeli-bank-importer-app/releases/download/' +
  'israeli-bank-importer-app-v0.3.0/';
const DOWNLOAD_URL = `${RELEASE_DOWNLOADS}israeli-bank-importer.apk`;
const SMS_DOWNLOAD_URL = `${RELEASE_DOWNLOADS}israeli-bank-importer.sms.apk`;

/**
 * Release assets as the Releases API lists them.
 * @param urls - The download URL of each asset, in listing order.
 * @returns The `assets` array.
 */
function assetsAt(...urls: string[]): { browser_download_url: string }[] {
  return urls.map((url) => ({ browser_download_url: url }));
}

const originalFetch = globalThis.fetch;

function release(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag_name: 'israeli-bank-importer-app-v0.3.0',
    assets: [{ browser_download_url: DOWNLOAD_URL }],
    ...overrides,
  };
}

function mockJson(body: unknown, ok = true): void {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(body),
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('normalizeVersion', () => {
  it('strips the component prefix from a release tag', () => {
    expect(normalizeVersion('israeli-bank-importer-app-v0.3.0')).toBe('0.3.0');
  });

  it('accepts a bare version', () => {
    expect(normalizeVersion('1.10.2')).toBe('1.10.2');
  });

  it('rejects a tag without a version', () => {
    expect(normalizeVersion('latest')).toBeNull();
  });
});

describe('isNewerVersion', () => {
  it.each([
    ['0.3.0', '0.2.0'],
    ['1.0.0', '0.9.9'],
    ['0.2.1', '0.2.0'],
    ['0.10.0', '0.9.0'],
  ])('treats %s as newer than %s', (candidate, current) => {
    expect(isNewerVersion(candidate, current)).toBe(true);
  });

  it.each([
    ['0.2.0', '0.2.0'],
    ['0.1.9', '0.2.0'],
    ['0.9.0', '0.10.0'],
  ])('treats %s as not newer than %s', (candidate, current) => {
    expect(isNewerVersion(candidate, current)).toBe(false);
  });

  it('treats an unparseable version as not newer', () => {
    expect(isNewerVersion('nightly', '0.2.0')).toBe(false);
    expect(isNewerVersion('0.3.0', 'nightly')).toBe(false);
  });
});

describe('apkAssetFor', () => {
  it('names the standard asset for a standard build', () => {
    expect(apkAssetFor(false)).toBe('israeli-bank-importer.apk');
  });

  it('names the SMS asset for an SMS auto-read build', () => {
    expect(apkAssetFor(true)).toBe('israeli-bank-importer.sms.apk');
  });

  it('keeps the standard asset first when release assets are sorted by name', () => {
    expect([SMS_APK_ASSET, STANDARD_APK_ASSET].sort()).toEqual([STANDARD_APK_ASSET, SMS_APK_ASSET]);
  });
});

describe('findApkDownloadUrl', () => {
  it('returns the package published under this repository', () => {
    expect(findApkDownloadUrl(assetsAt(DOWNLOAD_URL), STANDARD_APK_ASSET)).toBe(DOWNLOAD_URL);
  });

  it.each([
    ['standard first', [DOWNLOAD_URL, SMS_DOWNLOAD_URL]],
    ['SMS first', [SMS_DOWNLOAD_URL, DOWNLOAD_URL]],
  ])('gives a standard build the standard asset when both exist, %s', (_order, urls) => {
    expect(findApkDownloadUrl(assetsAt(...urls), STANDARD_APK_ASSET)).toBe(DOWNLOAD_URL);
  });

  it.each([
    ['standard first', [DOWNLOAD_URL, SMS_DOWNLOAD_URL]],
    ['SMS first', [SMS_DOWNLOAD_URL, DOWNLOAD_URL]],
  ])('gives an SMS build the SMS asset when both exist, %s', (_order, urls) => {
    expect(findApkDownloadUrl(assetsAt(...urls), SMS_APK_ASSET)).toBe(SMS_DOWNLOAD_URL);
  });

  it('offers an SMS build nothing when only the standard asset exists', () => {
    expect(findApkDownloadUrl(assetsAt(DOWNLOAD_URL), SMS_APK_ASSET)).toBeNull();
  });

  it('offers a standard build nothing when only the SMS asset exists', () => {
    expect(findApkDownloadUrl(assetsAt(SMS_DOWNLOAD_URL), STANDARD_APK_ASSET)).toBeNull();
  });

  it.each(['x-israeli-bank-importer.apk', 'israeli-bank-importer.apk.exe'])(
    'rejects the look-alike asset name %s',
    (name) => {
      expect(
        findApkDownloadUrl(assetsAt(`${RELEASE_DOWNLOADS}${name}`), STANDARD_APK_ASSET),
      ).toBeNull();
    },
  );

  it('ignores an asset hosted anywhere else', () => {
    const assets = assetsAt('https://evil.example.com/israeli-bank-importer.apk');

    expect(findApkDownloadUrl(assets, STANDARD_APK_ASSET)).toBeNull();
  });

  it('ignores a look-alike host that only starts with the github domain', () => {
    const assets = assetsAt(
      'https://github.com.evil.example/sergienko4/israeli-bank-importer-app/releases/download/' +
        'x/israeli-bank-importer.apk',
    );

    expect(findApkDownloadUrl(assets, STANDARD_APK_ASSET)).toBeNull();
  });

  it('ignores non-package assets such as the source archive', () => {
    const assets = assetsAt(
      'https://github.com/sergienko4/israeli-bank-importer-app/releases/download/x/src.zip',
    );

    expect(findApkDownloadUrl(assets, STANDARD_APK_ASSET)).toBeNull();
  });

  it('ignores a payload that is not an array', () => {
    expect(findApkDownloadUrl(null, STANDARD_APK_ASSET)).toBeNull();
    expect(
      findApkDownloadUrl({ browser_download_url: DOWNLOAD_URL }, STANDARD_APK_ASSET),
    ).toBeNull();
  });
});

describe('fetchLatestRelease', () => {
  it('reports a newer release with a downloadable package', async () => {
    mockJson(release());

    const expected: AvailableRelease = { version: '0.3.0', downloadUrl: DOWNLOAD_URL };
    await expect(fetchLatestRelease('0.2.0', STANDARD_APK_ASSET)).resolves.toEqual(expected);
  });

  it('reports the SMS asset to an SMS build', async () => {
    mockJson(release({ assets: assetsAt(DOWNLOAD_URL, SMS_DOWNLOAD_URL) }));

    const expected: AvailableRelease = { version: '0.3.0', downloadUrl: SMS_DOWNLOAD_URL };
    await expect(fetchLatestRelease('0.2.0', SMS_APK_ASSET)).resolves.toEqual(expected);
  });

  it('stays quiet for an SMS build when the release has only the standard asset', async () => {
    mockJson(release());

    await expect(fetchLatestRelease('0.2.0', SMS_APK_ASSET)).resolves.toBeNull();
  });

  it('sends the request to the public releases endpoint', async () => {
    mockJson(release());

    await fetchLatestRelease('0.2.0', STANDARD_APK_ASSET);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/sergienko4/israeli-bank-importer-app/releases/latest',
      expect.objectContaining({ headers: { accept: 'application/vnd.github+json' } }),
    );
  });

  it('stays quiet when the running version is already the latest', async () => {
    mockJson(release());

    await expect(fetchLatestRelease('0.3.0', STANDARD_APK_ASSET)).resolves.toBeNull();
  });

  it('stays quiet when the running version is ahead', async () => {
    mockJson(release());

    await expect(fetchLatestRelease('0.4.0', STANDARD_APK_ASSET)).resolves.toBeNull();
  });

  it('stays quiet when the release has no downloadable package', async () => {
    mockJson(release({ assets: [] }));

    await expect(fetchLatestRelease('0.2.0', STANDARD_APK_ASSET)).resolves.toBeNull();
  });

  it('stays quiet when the tag carries no version', async () => {
    mockJson(release({ tag_name: 'nightly' }));

    await expect(fetchLatestRelease('0.2.0', STANDARD_APK_ASSET)).resolves.toBeNull();
  });

  it('stays quiet when the payload is malformed', async () => {
    mockJson({});

    await expect(fetchLatestRelease('0.2.0', STANDARD_APK_ASSET)).resolves.toBeNull();
  });

  it('stays quiet when the request is rate limited', async () => {
    mockJson({ message: 'API rate limit exceeded' }, false);

    await expect(fetchLatestRelease('0.2.0', STANDARD_APK_ASSET)).resolves.toBeNull();
  });

  it('stays quiet when the device is offline', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('Network request failed'));

    await expect(fetchLatestRelease('0.2.0', STANDARD_APK_ASSET)).resolves.toBeNull();
  });
});
