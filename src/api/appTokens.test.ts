/**
 * Proves the refresh call treats a rotation failure as terminal.
 *
 * A 400 means the portal has already ended this session — either the token was
 * replayed or an operator revoked the device. Retrying cannot help, and a
 * client that keeps trying turns a revoked device into a permanent knock at the
 * door, so the message tells the caller to sign in again instead.
 */
import { refreshTokens, toAppTokens } from './appTokens';

const BASE = 'https://importer.example.ts.net';
const realFetch = globalThis.fetch;
let calls: { url: string; init?: RequestInit }[] = [];

/**
 * Stubs global fetch with a fixed response and records what it was sent.
 * @param status - HTTP status the stub returns.
 * @param body - JSON body the stub returns.
 */
function stubFetch(status: number, body: unknown): void {
  calls = [];
  globalThis.fetch = jest.fn((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as Response);
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('refreshTokens', () => {
  it('returns the rotated pair on 200', async () => {
    stubFetch(200, {
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      expiresIn: 900,
      sessionId: 'session-1',
    });
    const tokens = await refreshTokens(BASE, 'refresh-1');
    expect(tokens.accessToken).toBe('access-2');
    expect(tokens.refreshToken).toBe('refresh-2');
  });

  it('posts the refresh token to the portal', async () => {
    stubFetch(200, {
      accessToken: 'a',
      refreshToken: 'b',
      expiresIn: 900,
      sessionId: 's',
    });
    await refreshTokens(BASE, 'refresh-1');
    const sent = calls[0].init?.body as string;
    expect(calls[0].url).toBe(`${BASE}/auth/app/refresh`);
    expect(JSON.parse(sent)).toEqual({ refreshToken: 'refresh-1' });
  });

  it('normalizes the address before calling', async () => {
    stubFetch(200, { accessToken: 'a', refreshToken: 'b', expiresIn: 900, sessionId: 's' });
    await refreshTokens('importer.example.ts.net/', 'refresh-1');
    expect(calls[0].url).toBe('https://importer.example.ts.net/auth/app/refresh');
  });

  it('treats 400 as a session that has ended', async () => {
    stubFetch(400, { error: 'invalid_grant' });
    await expect(refreshTokens(BASE, 'stale')).rejects.toThrow(
      'Session expired. Please sign in again.',
    );
  });

  it('reports a rate limit separately, because waiting helps', async () => {
    stubFetch(429, {});
    await expect(refreshTokens(BASE, 'refresh-1')).rejects.toThrow(
      'Too many attempts. Wait a minute and try again.',
    );
  });

  it('reports any other status with its code', async () => {
    stubFetch(500, {});
    await expect(refreshTokens(BASE, 'refresh-1')).rejects.toThrow(
      'The importer returned an error (500).',
    );
  });

  it('refuses a body that is missing a token', async () => {
    stubFetch(200, { accessToken: 'a', expiresIn: 900, sessionId: 's' });
    await expect(refreshTokens(BASE, 'refresh-1')).rejects.toThrow(
      'Unexpected response from the importer.',
    );
  });
});

describe('toAppTokens', () => {
  it('converts the lifetime to a wall-clock deadline', () => {
    const before = Date.now();
    const tokens = toAppTokens({
      accessToken: 'a',
      refreshToken: 'b',
      expiresIn: 900,
      sessionId: 's',
    });
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 900_000);
    expect(tokens.expiresAt).toBeLessThanOrEqual(Date.now() + 900_000);
  });
});
