import { checkAuthorized, normalizeBaseUrl } from './importerClient';

/**
 * Builds a minimal fake fetch Response for tests.
 * @param status - HTTP status code.
 * @param body - JSON body the response resolves to.
 * @returns A Response-shaped stub.
 */
function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const realFetch = globalThis.fetch;

/**
 * Replaces global fetch with a stub that resolves to a fixed response.
 * @param status - HTTP status the stub returns.
 * @param body - JSON body the stub returns.
 */
function stubFetch(status: number, body: unknown): void {
  globalThis.fetch = jest.fn(() => Promise.resolve(fakeResponse(status, body)));
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('normalizeBaseUrl', () => {
  it('defaults to https when no scheme is present', () => {
    expect(normalizeBaseUrl('host:8080')).toBe('https://host:8080');
  });

  it('keeps https and strips trailing slashes', () => {
    expect(normalizeBaseUrl('https://host:8080/')).toBe('https://host:8080');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeBaseUrl('  https://host:8080  ')).toBe('https://host:8080');
  });

  it.each([
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://10.0.0.4:8080',
    'http://172.16.0.1:8080',
    'http://172.31.255.255:8080',
    'http://192.168.1.5:8080',
    'http://100.64.0.0:8080',
    'http://100.101.102.103:8080',
    'http://100.127.255.255:8080',
    'http://[::1]:8080',
  ])('allows plain http for %s', (address) => {
    expect(normalizeBaseUrl(address)).toBe(address);
  });

  it.each([
    'http://example.com',
    'http://8.8.8.8',
    'http://100.63.255.255:8080',
    'http://100.128.0.1:8080',
    'http://172.15.0.1:8080',
    'http://172.32.0.1:8080',
    'http://192.169.1.5:8080',
  ])('refuses plain http for %s', (address) => {
    expect(() => normalizeBaseUrl(address)).toThrow(
      'Use https:// for addresses outside your home network.',
    );
  });

  it('classifies the host, not the path', () => {
    expect(() => normalizeBaseUrl('http://example.com/127.0.0.1')).toThrow(
      'Use https:// for addresses outside your home network.',
    );
  });
});

describe('checkAuthorized', () => {
  it('is true when the importer reports authorized', async () => {
    stubFetch(200, { authorized: true });
    await expect(checkAuthorized('host:8080', 't')).resolves.toBe(true);
  });

  it('is false when the importer reports unauthorized', async () => {
    stubFetch(200, { authorized: false });
    await expect(checkAuthorized('host:8080', 't')).resolves.toBe(false);
  });

  it('is false on a non-ok response', async () => {
    stubFetch(401, {});
    await expect(checkAuthorized('host:8080', 't')).resolves.toBe(false);
  });
});
