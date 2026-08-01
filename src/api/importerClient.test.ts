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

  // This message is written here rather than drawn from errorMessages, because
  // it answers what the reader typed rather than what the importer replied. It
  // still owes the reader the same sentence, so it is held to the same rules.
  it('reads as a plain instruction, like the rest of the app', () => {
    let message = '';
    try {
      normalizeBaseUrl('http://host:8080');
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toMatch(/invalid|illegal|incorrect|forbidden|bad request/i);
    expect(message).not.toMatch(/\(\d{3}\)|\berror\b|\bfailed\b/i);
    expect(message).toMatch(/^[A-Z].*\.$/);
    expect(message).toMatch(/https:\/\//);
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

describe('a connection that never opens', () => {
  // Every caller of these functions puts a raised message straight in front of
  // the reader, so a platform string must not be what gets raised.
  it('names the importer as unreachable instead of repeating the platform', async () => {
    globalThis.fetch = jest.fn(() => Promise.reject(new Error('Network request failed')));
    await expect(checkAuthorized('https://host:8080', 'token')).rejects.toThrow(
      'Could not reach the importer',
    );
  });

  it('does not let the platform wording through', async () => {
    globalThis.fetch = jest.fn(() => Promise.reject(new Error('Network request failed')));
    await expect(checkAuthorized('https://host:8080', 'token')).rejects.not.toThrow(
      'Network request failed',
    );
  });

  it('keeps the address complaint, which is not a transport failure', async () => {
    globalThis.fetch = jest.fn(() => Promise.reject(new Error('Network request failed')));
    await expect(checkAuthorized('http://host:8080', 'token')).rejects.toThrow(
      'Start the address with https://',
    );
  });
});
