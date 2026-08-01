import {
  getConfig,
  getStatus,
  type Session,
  setReauthHandler,
  setSessionGuard,
} from './importerClient';

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
  setSessionGuard(null);
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
    await expect(getConfig(session)).rejects.toThrow('session has ended');
  });

  it('propagates the 401 when reauth returns null', async () => {
    globalThis.fetch = jest.fn(() => Promise.resolve(fakeResponse(401, {})));
    setReauthHandler(async () => null);
    await expect(getConfig(session)).rejects.toThrow('session has ended');
  });

  it('retries at most once', async () => {
    let call = 0;
    globalThis.fetch = jest.fn(() => {
      call += 1;
      return Promise.resolve(fakeResponse(401, {}));
    });
    setReauthHandler(async () => ({ baseUrl: 'https://host:8080', token: 'fresh' }));

    await expect(getConfig(session)).rejects.toThrow('session has ended');
    expect(call).toBe(2);
  });
});

describe('the pre-flight session guard', () => {
  beforeEach(() => {
    authHeaders = [];
  });

  it('renews an expiring token before the request, not after a 401', async () => {
    globalThis.fetch = jest.fn((_url: string, init?: RequestInit) => {
      authHeaders.push(authOf(init));
      return Promise.resolve(fakeResponse(200, { ok: true }));
    }) as unknown as typeof fetch;
    setSessionGuard(async () => ({ baseUrl: 'https://host:8080', token: 'renewed' }));

    await expect(getConfig(session)).resolves.toEqual({ ok: true });
    expect(authHeaders).toEqual(['Bearer renewed']);
  });

  it('leaves a healthy session untouched', async () => {
    globalThis.fetch = jest.fn((_url: string, init?: RequestInit) => {
      authHeaders.push(authOf(init));
      return Promise.resolve(fakeResponse(200, { ok: true }));
    }) as unknown as typeof fetch;
    setSessionGuard(async (active) => active);

    await getConfig(session);
    expect(authHeaders).toEqual(['Bearer old']);
  });

  it('still falls back to re-auth when the renewed token is already dead', async () => {
    let call = 0;
    globalThis.fetch = jest.fn((_url: string, init?: RequestInit) => {
      call += 1;
      authHeaders.push(authOf(init));
      return Promise.resolve(call === 1 ? fakeResponse(401, {}) : fakeResponse(200, { ok: true }));
    }) as unknown as typeof fetch;
    setSessionGuard(async () => ({ baseUrl: 'https://host:8080', token: 'renewed' }));
    setReauthHandler(async () => ({ baseUrl: 'https://host:8080', token: 'fresh' }));

    await expect(getConfig(session)).resolves.toEqual({ ok: true });
    expect(authHeaders).toEqual(['Bearer renewed', 'Bearer fresh']);
  });
});

describe('concurrent requests that all expire at once', () => {
  it('re-authenticates once for three simultaneous 401s', async () => {
    const seen: string[] = [];
    globalThis.fetch = jest.fn((_url: string, init?: RequestInit) => {
      const header = authOf(init) ?? '';
      seen.push(header);
      return Promise.resolve(
        header === 'Bearer old' ? fakeResponse(401, {}) : fakeResponse(200, []),
      );
    }) as unknown as typeof fetch;

    let reauths = 0;
    setReauthHandler(async () => {
      reauths += 1;
      await Promise.resolve();
      return { baseUrl: 'https://host:8080', token: 'fresh' };
    });

    await Promise.all([getStatus(session), getStatus(session), getStatus(session)]);
    expect(reauths).toBe(1);
    expect(seen.filter((header) => header === 'Bearer fresh')).toHaveLength(3);
  });
});
