/**
 * Proves the browser sign-in behaves at each point where it could hand an
 * attacker something: the redirect it accepts, the state it checks before the
 * code is used, and the responses it refuses to treat as tokens.
 *
 * The browser and the device name are native modules, so both are stubbed. The
 * assertion that matters most is the one about `fetch` never being called when
 * the state does not match — a redirect from somewhere else must die before the
 * code reaches the network.
 */
import { REDIRECT_URI, signIn } from './appAuthFlow';

const mockBrowser = {
  result: { type: 'success', url: `${REDIRECT_URI}?code=the-code&state=` } as {
    type: string;
    url?: string;
  },
  openedUrl: '',
};

jest.mock('expo-web-browser', () => ({
  WebBrowserResultType: { CANCEL: 'cancel', DISMISS: 'dismiss', LOCKED: 'locked' },
  openAuthSessionAsync: (url: string) => {
    mockBrowser.openedUrl = url;
    return Promise.resolve(mockBrowser.result);
  },
}));

jest.mock('expo-device', () => ({ deviceName: 'Pixel 8' }));

const mockSeed = { value: 0 };

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { BASE64: 'base64' },
  getRandomBytesAsync: (byteCount: number) => {
    mockSeed.value += 1;
    const values = Array.from(
      { length: byteCount },
      (_unused, index) => (index * 31 + mockSeed.value) % 256,
    );
    return Promise.resolve(new Uint8Array(values));
  },
  digestStringAsync: () => Promise.resolve('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw+cM='),
}));

jest.mock('expo-linking', () => ({
  parse: (url: string) => {
    const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
    const queryParams: Record<string, string> = {};
    for (const pair of query.split('&')) {
      if (pair.length > 0) {
        const [key, value] = pair.split('=');
        queryParams[decodeURIComponent(key)] = decodeURIComponent(value);
      }
    }
    return { queryParams };
  },
}));

const BASE = 'https://importer.example.ts.net';
const TOKEN_BODY = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresIn: 900,
  tokenType: 'Bearer',
  sessionId: 'session-1',
};

const realFetch = globalThis.fetch;
let fetchCalls: { url: string; init?: RequestInit }[] = [];

/**
 * Stubs global fetch with a fixed response and records what it was sent.
 * @param status - HTTP status the stub returns.
 * @param body - JSON body the stub returns.
 */
function stubFetch(status: number, body: unknown): void {
  fetchCalls = [];
  globalThis.fetch = jest.fn((url: string, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as Response);
  }) as unknown as typeof fetch;
}

/**
 * Reads the state the flow put in the authorization URL.
 * @returns The state parameter, or an empty string.
 */
function openedState(): string {
  const query = mockBrowser.openedUrl.slice(mockBrowser.openedUrl.indexOf('?') + 1);
  return new URLSearchParams(query).get('state') ?? '';
}

/**
 * Answers the browser with a redirect that echoes the state just requested.
 *
 * The URL is a getter because the state is only known once the flow has opened
 * the browser, which is exactly the point at which the stub is read.
 * @param params - Extra query parameters to include alongside the state.
 */
function replyWithRedirect(params: Record<string, string>): void {
  mockBrowser.result = {
    type: 'success',
    get url(): string {
      const query = new URLSearchParams({ state: openedState(), ...params });
      return `${REDIRECT_URI}?${query.toString()}`;
    },
  };
}

beforeEach(() => {
  mockBrowser.openedUrl = '';
  replyWithRedirect({ code: 'the-code' });
  stubFetch(200, TOKEN_BODY);
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('signIn authorization request', () => {
  it('asks for a code with S256 and the app scheme', async () => {
    await signIn(BASE);
    const query = new URLSearchParams(
      mockBrowser.openedUrl.slice(mockBrowser.openedUrl.indexOf('?') + 1),
    );
    expect(mockBrowser.openedUrl.startsWith(`${BASE}/auth/app/authorize?`)).toBe(true);
    expect(query.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(query.get('code_challenge_method')).toBe('S256');
    expect(query.get('code_challenge')).toMatch(/^[\w-]{43}$/);
    expect(query.get('device_name')).toBe('Pixel 8');
  });

  it('normalizes the address before opening the browser', async () => {
    await signIn('  importer.example.ts.net/  ');
    expect(mockBrowser.openedUrl.startsWith('https://importer.example.ts.net/auth/app/')).toBe(
      true,
    );
  });

  it('refuses a clear-text address outside the private ranges', async () => {
    await expect(signIn('http://example.com')).rejects.toThrow('Use https://');
    expect(mockBrowser.openedUrl).toBe('');
  });
});

describe('signIn token exchange', () => {
  it('returns the token pair with an absolute expiry', async () => {
    const before = Date.now();
    const tokens = await signIn(BASE);
    expect(tokens.accessToken).toBe('access-1');
    expect(tokens.refreshToken).toBe('refresh-1');
    expect(tokens.sessionId).toBe('session-1');
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 900_000);
  });

  it('redeems the code with the verifier behind the challenge', async () => {
    await signIn(BASE);
    const query = new URLSearchParams(
      mockBrowser.openedUrl.slice(mockBrowser.openedUrl.indexOf('?') + 1),
    );
    const sent = fetchCalls[0].init?.body as string;
    const body = JSON.parse(sent) as Record<string, string>;
    expect(fetchCalls[0].url).toBe(`${BASE}/auth/app/token`);
    expect(body.code).toBe('the-code');
    expect(body.redirect_uri).toBe(REDIRECT_URI);
    expect(body.code_verifier).toMatch(/^[\w-]{43}$/);
    expect(body.code_verifier).not.toBe(query.get('code_challenge'));
  });
});

describe('signIn when the browser does not complete', () => {
  it.each(['cancel', 'dismiss'])('reports %s as a cancellation', async (type) => {
    mockBrowser.result = { type };
    await expect(signIn(BASE)).rejects.toThrow('Sign-in was cancelled.');
    expect(fetchCalls).toHaveLength(0);
  });

  it('reports any other outcome as a failure', async () => {
    mockBrowser.result = { type: 'locked' };
    await expect(signIn(BASE)).rejects.toThrow('Sign-in could not be completed.');
  });
});

describe('signIn when the redirect is not ours', () => {
  it('refuses a redirect that is not the app scheme, state notwithstanding', async () => {
    mockBrowser.result = {
      type: 'success',
      get url(): string {
        return `https://evil.example/?code=the-code&state=${openedState()}`;
      },
    };
    await expect(signIn(BASE)).rejects.toThrow('Sign-in could not be verified.');
    expect(fetchCalls).toHaveLength(0);
  });

  it('refuses a mismatched state without touching the network', async () => {
    mockBrowser.result = { type: 'success', url: `${REDIRECT_URI}?code=x&state=not-ours` };
    await expect(signIn(BASE)).rejects.toThrow('Sign-in could not be verified.');
    expect(fetchCalls).toHaveLength(0);
  });

  it('refuses a redirect with no state at all', async () => {
    mockBrowser.result = { type: 'success', url: `${REDIRECT_URI}?code=x` };
    await expect(signIn(BASE)).rejects.toThrow('Sign-in could not be verified.');
    expect(fetchCalls).toHaveLength(0);
  });

  it('surfaces an error the portal reported', async () => {
    replyWithRedirect({ error: 'invalid_redirect_uri' });
    await expect(signIn(BASE)).rejects.toThrow('invalid_redirect_uri');
    expect(fetchCalls).toHaveLength(0);
  });

  it('refuses a redirect that carries no code', async () => {
    replyWithRedirect({});
    await expect(signIn(BASE)).rejects.toThrow('Sign-in did not return a code.');
    expect(fetchCalls).toHaveLength(0);
  });
});

describe('signIn when the portal refuses the code', () => {
  it.each([
    [503, 'This importer does not have app sign-in enabled.'],
    [400, 'Sign-in expired. Please try again.'],
    [429, 'Too many attempts. Wait a minute and try again.'],
    [500, 'The importer returned an error (500).'],
  ])('maps %s to its message', async (status, message) => {
    stubFetch(Number(status), {});
    await expect(signIn(BASE)).rejects.toThrow(String(message));
  });

  it.each([
    ['no access token', { refreshToken: 'r', expiresIn: 900, sessionId: 's' }],
    ['no refresh token', { accessToken: 'a', expiresIn: 900, sessionId: 's' }],
    [
      'an empty access token',
      { accessToken: '', refreshToken: 'r', expiresIn: 900, sessionId: 's' },
    ],
    [
      'a non-numeric lifetime',
      { accessToken: 'a', refreshToken: 'r', expiresIn: '900', sessionId: 's' },
    ],
    ['no session id', { accessToken: 'a', refreshToken: 'r', expiresIn: 900 }],
  ])('refuses a body with %s', async (_label, body) => {
    stubFetch(200, body);
    await expect(signIn(BASE)).rejects.toThrow('Unexpected response from the importer.');
  });
});
