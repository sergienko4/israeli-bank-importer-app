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

  it('lowercases the scheme without touching the rest', () => {
    expect(normalizeBaseUrl('HTTPS://Host:8080')).toBe('https://Host:8080');
  });

  it.each([
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://192.168.1.5:8080',
    'http://100.64.0.1:8080',
    'http://example.com',
    'http://8.8.8.8',
    'http://[::1]:8080',
  ])('refuses plain http for %s', (address) => {
    expect(() => normalizeBaseUrl(address)).toThrow('Start the address with https://');
  });

  it('refuses plain http whatever the case of the scheme', () => {
    expect(() => normalizeBaseUrl('HTTP://host:8080')).toThrow('Start the address with https://');
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
