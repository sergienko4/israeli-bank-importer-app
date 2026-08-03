import { registerDevice, type Session, unregisterDevice } from './importerClient';

const session: Session = { baseUrl: 'https://host:8080', token: 'tok' };
let calls: { url: string; method?: string }[] = [];
const realFetch = globalThis.fetch;

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

/**
 * Stubs global fetch, recording each call's URL + method.
 * @param status - HTTP status the stub returns.
 * @param body - JSON body the stub returns.
 */
function stubFetch(status: number, body: unknown): void {
  calls = [];
  globalThis.fetch = jest.fn((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method });
    return Promise.resolve(fakeResponse(status, body));
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('registerDevice', () => {
  it('POSTs the token to /api/devices', async () => {
    stubFetch(200, { ok: true });
    const result = await registerDevice(session, 'ExponentPushToken[a]');
    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe('https://host:8080/api/devices');
    expect(calls[0].method).toBe('POST');
  });

  it('reports a failure body', async () => {
    stubFetch(400, { error: 'bad' });
    await expect(registerDevice(session, 't')).resolves.toEqual({
      ok: false,
      error: 'bad',
      errors: undefined,
      status: 400,
    });
  });
});

describe('unregisterDevice', () => {
  it('DELETEs the token from /api/devices', async () => {
    stubFetch(200, { ok: true });
    const result = await unregisterDevice(session, 't');
    expect(result.ok).toBe(true);
    expect(calls[0].method).toBe('DELETE');
  });
});
