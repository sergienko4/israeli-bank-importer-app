import {
  getConfig,
  getManifest,
  getStatus,
  removeBank,
  saveConfig,
  type Session,
} from './importerClient';

const session: Session = { baseUrl: 'http://host:8080', token: 'tok' };

interface RecordedCall {
  url: string;
  init?: RequestInit;
}

let calls: RecordedCall[] = [];
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
 * Stubs global fetch, recording each call and resolving to a fixed response.
 * @param status - HTTP status the stub returns.
 * @param body - JSON body the stub returns.
 */
function stubFetch(status: number, body: unknown): void {
  calls = [];
  globalThis.fetch = jest.fn((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(fakeResponse(status, body));
  }) as unknown as typeof fetch;
}

/**
 * Reads the Authorization header from the last recorded call.
 * @returns The Authorization header value, or undefined.
 */
function lastAuthHeader(): string | undefined {
  const headers = calls[0]?.init?.headers as Record<string, string> | undefined;
  return headers?.authorization;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('getManifest', () => {
  it('loads the manifest with a bearer header and correct URL', async () => {
    stubFetch(200, { sections: [], banks: ['leumi'], bankRequirements: {} });
    const manifest = await getManifest(session);
    expect(manifest.banks).toEqual(['leumi']);
    expect(calls[0].url).toBe('http://host:8080/api/manifest');
    expect(lastAuthHeader()).toBe('Bearer tok');
  });
});

describe('getConfig', () => {
  it('returns the config on success', async () => {
    stubFetch(200, { banks: {}, actual: {} });
    await expect(getConfig(session)).resolves.toEqual({ banks: {}, actual: {} });
  });

  it('throws a reconnect message on 401', async () => {
    stubFetch(401, {});
    await expect(getConfig(session)).rejects.toThrow('Session expired');
  });
});

describe('saveConfig', () => {
  it('PUTs the config and reports success', async () => {
    stubFetch(200, { ok: true });
    const result = await saveConfig(session, { a: 1 });
    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe('http://host:8080/api/config');
    expect(calls[0].init?.method).toBe('PUT');
  });

  it('surfaces validation errors on 400', async () => {
    stubFetch(400, { error: 'Invalid', errors: ['bad field'] });
    const result = await saveConfig(session, { a: 1 });
    expect(result).toEqual({ ok: false, error: 'Invalid', errors: ['bad field'] });
  });
});

describe('removeBank', () => {
  it('DELETEs a bank', async () => {
    stubFetch(200, { ok: true });
    const result = await removeBank(session, 'discount');
    expect(result.ok).toBe(true);
    expect(calls[0].init?.method).toBe('DELETE');
  });

  it('reports a failure body from the importer', async () => {
    stubFetch(400, { error: 'nope' });
    const result = await removeBank(session, 'discount');
    expect(result).toEqual({ ok: false, error: 'nope', errors: undefined });
  });
});

describe('getStatus', () => {
  it('returns the runs on success', async () => {
    stubFetch(200, { runs: [{ timestamp: 't', banks: [] }] });
    await expect(getStatus(session)).resolves.toHaveLength(1);
  });

  it('returns an empty list when there are no runs', async () => {
    stubFetch(200, {});
    await expect(getStatus(session)).resolves.toEqual([]);
  });

  it('throws a reconnect message on 401', async () => {
    stubFetch(401, {});
    await expect(getStatus(session)).rejects.toThrow('Session expired');
  });
});
