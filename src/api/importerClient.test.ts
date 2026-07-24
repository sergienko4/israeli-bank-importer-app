import { checkAuthorized, normalizeBaseUrl, requestToken } from './importerClient';

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

describe('normalizeBaseUrl', () => {
  it('adds http:// when no scheme is present', () => {
    expect(normalizeBaseUrl('100.64.0.1:8080')).toBe('http://100.64.0.1:8080');
  });

  it('keeps https and strips trailing slashes', () => {
    expect(normalizeBaseUrl('https://host:8080/')).toBe('https://host:8080');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeBaseUrl('  http://host:8080  ')).toBe('http://host:8080');
  });
});

describe('requestToken', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the token on a 200 response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(fakeResponse(200, { token: 'abc123' }));
    await expect(requestToken('host:8080', 'pw')).resolves.toBe('abc123');
  });

  it('throws a friendly message on 401', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(fakeResponse(401, { error: 'Invalid password' }));
    await expect(requestToken('host:8080', 'bad')).rejects.toThrow('Incorrect portal password.');
  });

  it('throws on a server error status', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(fakeResponse(500, {}));
    await expect(requestToken('host:8080', 'pw')).rejects.toThrow('500');
  });

  it('throws when the body carries no token', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(fakeResponse(200, {}));
    await expect(requestToken('host:8080', 'pw')).rejects.toThrow('Unexpected response');
  });
});

describe('checkAuthorized', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is true when the importer reports authorized', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(fakeResponse(200, { authorized: true }));
    await expect(checkAuthorized('host:8080', 't')).resolves.toBe(true);
  });

  it('is false when the importer reports unauthorized', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(fakeResponse(200, { authorized: false }));
    await expect(checkAuthorized('host:8080', 't')).resolves.toBe(false);
  });

  it('is false on a non-ok response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(fakeResponse(401, {}));
    await expect(checkAuthorized('host:8080', 't')).resolves.toBe(false);
  });
});
