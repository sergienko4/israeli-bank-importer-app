import { getConfig, type Session, setReauthHandler } from './importerClient';

const session: Session = { baseUrl: 'https://host:8080', token: 'old' };
const realFetch = globalThis.fetch;
let authHeaders: (string | undefined)[] = [];

/**
 * Builds a minimal fake fetch Response for tests.
 * @param status - HTTP status code.
 * @param body - JSON body the response resolves to.
 * @returns A Response-shaped stub.
 */
function fakeResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

/**
 * Reads the Authorization header from a fetch init.
 * @param init - The fetch init.
 * @returns The authorization header value, if any.
 */
function authOf(init?: RequestInit): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.authorization;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  setReauthHandler(null);
});

describe('silent re-auth on 401', () => {
  beforeEach(() => {
    authHeaders = [];
  });

  it('re-authenticates and retries once with the fresh token', async () => {
    let call = 0;
    globalThis.fetch = jest.fn((_url: string, init?: RequestInit) => {
      call += 1;
      authHeaders.push(authOf(init));
      return Promise.resolve(call === 1 ? fakeResponse(401, {}) : fakeResponse(200, { ok: true }));
    }) as unknown as typeof fetch;
    setReauthHandler(async () => ({ baseUrl: 'https://host:8080', token: 'fresh' }));

    await expect(getConfig(session)).resolves.toEqual({ ok: true });
    expect(authHeaders).toEqual(['Bearer old', 'Bearer fresh']);
  });

  it('propagates the 401 when no reauth handler is set', async () => {
    globalThis.fetch = jest.fn(() => Promise.resolve(fakeResponse(401, {})));
    setReauthHandler(null);
    await expect(getConfig(session)).rejects.toThrow('Session expired');
  });

  it('propagates the 401 when reauth returns null', async () => {
    globalThis.fetch = jest.fn(() => Promise.resolve(fakeResponse(401, {})));
    setReauthHandler(async () => null);
    await expect(getConfig(session)).rejects.toThrow('Session expired');
  });

  it('retries at most once', async () => {
    let call = 0;
    globalThis.fetch = jest.fn(() => {
      call += 1;
      return Promise.resolve(fakeResponse(401, {}));
    });
    setReauthHandler(async () => ({ baseUrl: 'https://host:8080', token: 'fresh' }));

    await expect(getConfig(session)).rejects.toThrow('Session expired');
    expect(call).toBe(2);
  });
});
