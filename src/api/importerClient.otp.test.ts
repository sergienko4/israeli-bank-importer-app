import {
  getOtpSettings,
  getPendingOtp,
  getPendingOtpUnattended,
  type Session,
  setOtpSettings,
  setReauthHandler,
  setSessionGuard,
  submitOtp,
  submitOtpUnattended,
} from './importerClient';
import { NO_RESPONSE } from './timedFetch';

const session: Session = { baseUrl: 'https://host:8080', token: 'tok' };
let calls: { url: string; method?: string; body?: string; bearer?: string }[] = [];
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
 * Stubs global fetch, recording each call's URL, method, and body.
 * @param status - HTTP status the stub returns.
 * @param body - JSON body the stub returns.
 */
function stubFetch(status: number, body: unknown): void {
  calls = [];
  globalThis.fetch = jest.fn((url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({
      url: String(url),
      method: init?.method,
      body: init?.body as string | undefined,
      bearer: headers?.authorization,
    });
    return Promise.resolve(fakeResponse(status, body));
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  setSessionGuard(null);
  setReauthHandler(null);
  jest.useRealTimers();
});

describe('getOtpSettings', () => {
  it('GETs the channel from /api/otp/settings', async () => {
    stubFetch(200, { channel: 'app' });
    await expect(getOtpSettings(session)).resolves.toEqual({ channel: 'app' });
    expect(calls[0].url).toBe('https://host:8080/api/otp/settings');
  });

  it('throws on a failure status', async () => {
    stubFetch(500, {});
    await expect(getOtpSettings(session)).rejects.toThrow(
      'The importer is not answering right now',
    );
  });
});

describe('setOtpSettings', () => {
  it('PUTs the channel to /api/otp/settings', async () => {
    stubFetch(200, { ok: true });
    const result = await setOtpSettings(session, 'app');
    expect(result.ok).toBe(true);
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].body).toContain('app');
  });

  it('reports a failure body', async () => {
    stubFetch(400, { error: 'bad' });
    await expect(setOtpSettings(session, 'telegram')).resolves.toEqual({
      ok: false,
      error: 'bad',
      errors: undefined,
      status: 400,
    });
  });
});

describe('getPendingOtp', () => {
  it('returns the requests array', async () => {
    const requests = [{ id: 'r1', bankId: 'leumi', createdAt: 1, deadline: 2 }];
    stubFetch(200, { requests });
    await expect(getPendingOtp(session)).resolves.toEqual(requests);
  });

  it('says so when the importer sends something it cannot read', async () => {
    // An answer with no requests field is not the same as no requests
    // pending, and showing it as the latter hides a real problem.
    stubFetch(200, {});
    await expect(getPendingOtp(session)).rejects.toThrow('could not read');
  });

  it('returns an empty array when nothing is pending', async () => {
    stubFetch(200, { requests: [] });
    await expect(getPendingOtp(session)).resolves.toEqual([]);
  });

  it('throws on a failure status', async () => {
    stubFetch(500, {});
    await expect(getPendingOtp(session)).rejects.toThrow('The importer is not answering right now');
  });
});

describe('submitOtp', () => {
  it('POSTs the code to /api/otp/:id', async () => {
    stubFetch(200, { ok: true });
    const result = await submitOtp(session, 'r1', '123456');
    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe('https://host:8080/api/otp/r1');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toContain('123456');
  });

  it('reports a failure body', async () => {
    stubFetch(404, { error: 'gone' });
    await expect(submitOtp(session, 'r1', '123456')).resolves.toEqual({
      ok: false,
      error: 'gone',
      errors: undefined,
      status: 404,
    });
  });
});

describe('unattended OTP calls', () => {
  const renewed: Session = { baseUrl: 'https://host:8080', token: 'renewed-in-background' };
  const prompts = { guard: jest.fn(), reauth: jest.fn() };

  beforeEach(() => {
    // Both of these end in a biometric prompt on the real screen, and a prompt
    // with the app closed never calls back.
    prompts.guard.mockReset();
    prompts.reauth.mockReset();
    setSessionGuard((active) => {
      prompts.guard();
      return Promise.resolve(active);
    });
    setReauthHandler(() => {
      prompts.reauth();
      return Promise.resolve(null);
    });
  });

  it('reads pending requests with the renewed token and never reaches for a prompt', async () => {
    const requests = [{ id: 'r1', bankId: 'leumi', createdAt: 1, deadline: 2 }];
    stubFetch(200, { requests });
    await expect(getPendingOtpUnattended(renewed)).resolves.toEqual(requests);
    expect(calls[0]).toMatchObject({
      url: 'https://host:8080/api/otp/pending',
      bearer: 'Bearer renewed-in-background',
    });
    expect(prompts.guard).not.toHaveBeenCalled();
  });

  it('submits the code to the pending request', async () => {
    stubFetch(200, { ok: true });
    await expect(submitOtpUnattended(renewed, 'r/1', '123456')).resolves.toEqual({ ok: true });
    expect(calls[0]).toMatchObject({
      url: 'https://host:8080/api/otp/r%2F1',
      method: 'POST',
      body: JSON.stringify({ code: '123456' }),
      bearer: 'Bearer renewed-in-background',
    });
    expect(prompts.guard).not.toHaveBeenCalled();
  });

  it('takes a refusal as the answer instead of re-authenticating', async () => {
    stubFetch(401, { error: 'Unauthorized' });
    await expect(submitOtpUnattended(renewed, 'r1', '123456')).resolves.toMatchObject({
      ok: false,
      status: 401,
    });
    await expect(getPendingOtpUnattended(renewed)).rejects.toThrow(Error);
    expect(prompts.reauth).not.toHaveBeenCalled();
    expect(calls).toHaveLength(2);
  });

  it('gives up on an importer that never answers, before Android freezes the task', async () => {
    jest.useFakeTimers();
    globalThis.fetch = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('Aborted'));
          });
        }),
    ) as unknown as typeof fetch;
    const pending = getPendingOtpUnattended(renewed);
    const outcome = expect(pending).rejects.toThrow(NO_RESPONSE);
    await jest.advanceTimersByTimeAsync(15_000);
    await outcome;
  });
});
