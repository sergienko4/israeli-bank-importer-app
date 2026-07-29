import {
  type AvailableRelease,
  fetchLatestRelease,
  findApkDownloadUrl,
  isNewerVersion,
  normalizeVersion,
} from './releaseCheck';

const DOWNLOAD_URL =
  'https://github.com/sergienko4/israeli-bank-importer-app/releases/download/' +
  'israeli-bank-importer-app-v0.3.0/israeli-bank-importer.apk';

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

describe('findApkDownloadUrl', () => {
  it('returns the package published under this repository', () => {
    expect(findApkDownloadUrl([{ browser_download_url: DOWNLOAD_URL }])).toBe(DOWNLOAD_URL);
  });

  it('ignores an asset hosted anywhere else', () => {
    const assets = [{ browser_download_url: 'https://evil.example.com/israeli.apk' }];

    expect(findApkDownloadUrl(assets)).toBeNull();
  });

  it('ignores a look-alike host that only starts with the github domain', () => {
    const assets = [{ browser_download_url: 'https://github.com.evil.example/x.apk' }];

    expect(findApkDownloadUrl(assets)).toBeNull();
  });

  it('ignores non-package assets such as the source archive', () => {
    const assets = [
      {
        browser_download_url:
          'https://github.com/sergienko4/israeli-bank-importer-app/releases/download/x/src.zip',
      },
    ];

    expect(findApkDownloadUrl(assets)).toBeNull();
  });

  it('ignores a payload that is not an array', () => {
    expect(findApkDownloadUrl(null)).toBeNull();
    expect(findApkDownloadUrl({ browser_download_url: DOWNLOAD_URL })).toBeNull();
  });
});

describe('fetchLatestRelease', () => {
  it('reports a newer release with a downloadable package', async () => {
    mockJson(release());

    const expected: AvailableRelease = { version: '0.3.0', downloadUrl: DOWNLOAD_URL };
    await expect(fetchLatestRelease('0.2.0')).resolves.toEqual(expected);
  });

  it('sends the request to the public releases endpoint', async () => {
    mockJson(release());

    await fetchLatestRelease('0.2.0');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/sergienko4/israeli-bank-importer-app/releases/latest',
      expect.objectContaining({ headers: { accept: 'application/vnd.github+json' } }),
    );
  });

  it('stays quiet when the running version is already the latest', async () => {
    mockJson(release());

    await expect(fetchLatestRelease('0.3.0')).resolves.toBeNull();
  });

  it('stays quiet when the running version is ahead', async () => {
    mockJson(release());

    await expect(fetchLatestRelease('0.4.0')).resolves.toBeNull();
  });

  it('stays quiet when the release has no downloadable package', async () => {
    mockJson(release({ assets: [] }));

    await expect(fetchLatestRelease('0.2.0')).resolves.toBeNull();
  });

  it('stays quiet when the tag carries no version', async () => {
    mockJson(release({ tag_name: 'nightly' }));

    await expect(fetchLatestRelease('0.2.0')).resolves.toBeNull();
  });

  it('stays quiet when the payload is malformed', async () => {
    mockJson({});

    await expect(fetchLatestRelease('0.2.0')).resolves.toBeNull();
  });

  it('stays quiet when the request is rate limited', async () => {
    mockJson({ message: 'API rate limit exceeded' }, false);

    await expect(fetchLatestRelease('0.2.0')).resolves.toBeNull();
  });

  it('stays quiet when the device is offline', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('Network request failed'));

    await expect(fetchLatestRelease('0.2.0')).resolves.toBeNull();
  });
});
