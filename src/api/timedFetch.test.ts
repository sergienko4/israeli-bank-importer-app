/**
 * Proves a request cannot outlive its deadline.
 *
 * The importer is self-hosted and reached over a private network, so "accepted
 * the connection and then went quiet" is a real state. Without the deadline the
 * app would sit on a spinner indefinitely with every later request queued
 * behind it, which the user cannot recover from without force-quitting.
 */
import { NO_RESPONSE, timedFetch } from './timedFetch';

const realFetch = globalThis.fetch;

const asIs = (res: Response): Promise<Response> => Promise.resolve(res);

afterEach(() => {
  globalThis.fetch = realFetch;
  jest.useRealTimers();
});

describe('timedFetch', () => {
  it('returns the response when it arrives in time', async () => {
    const response = { ok: true, status: 200 } as Response;
    globalThis.fetch = jest.fn(() => Promise.resolve(response));
    await expect(timedFetch('https://h/x', { method: 'POST' }, asIs)).resolves.toBe(response);
  });

  it('passes an abort signal alongside the caller options', async () => {
    const seen: RequestInit[] = [];
    globalThis.fetch = jest.fn((_url: string, init: RequestInit) => {
      seen.push(init);
      return Promise.resolve({ ok: true } as Response);
    }) as unknown as typeof fetch;
    await timedFetch('https://h/x', { method: 'POST', body: 'payload' }, asIs);
    expect(seen[0].method).toBe('POST');
    expect(seen[0].body).toBe('payload');
    expect(seen[0].signal).toBeInstanceOf(AbortSignal);
  });

  it('gives up on an importer that never answers', async () => {
    jest.useFakeTimers();
    globalThis.fetch = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new Error('Aborted'));
          });
        }),
    ) as unknown as typeof fetch;
    const pending = timedFetch('https://h/x', {}, asIs);
    jest.advanceTimersByTime(15_000);
    await expect(pending).rejects.toThrow(NO_RESPONSE);
  });

  it('gives up on a reply whose body stalls after the headers arrived', async () => {
    // The refresh call reads its body under the refresh lock, so a body that
    // never finishes would hold up every renewal in the process.
    jest.useFakeTimers();
    const stalled = { ok: true, status: 200, json: () => new Promise(() => undefined) };
    globalThis.fetch = jest.fn(() => Promise.resolve(stalled as unknown as Response));
    const pending = timedFetch('https://h/x', {}, async (res) => res.json() as Promise<unknown>);
    await Promise.resolve();
    jest.advanceTimersByTime(15_000);
    await expect(pending).rejects.toThrow(NO_RESPONSE);
  });

  it("hands the reader's own failure back unchanged", async () => {
    globalThis.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 400 } as Response));
    const refused = timedFetch('https://h/x', {}, () =>
      Promise.reject(new Error('Session ended.')),
    );
    await expect(refused).rejects.toThrow('Session ended.');
  });

  it('stops the clock once the reply has been read', async () => {
    jest.useFakeTimers();
    globalThis.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200 } as Response));
    await timedFetch('https://h/x', {}, asIs);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('names the importer as unreachable rather than repeating the platform', async () => {
    // "Network request failed" is what Android calls it. It names the failure,
    // offers no way out, and is not wording anyone chose to show a reader.
    globalThis.fetch = jest.fn(() => Promise.reject(new Error('Network request failed')));
    await expect(timedFetch('https://h/x', {}, asIs)).rejects.toThrow(
      'Could not reach the importer',
    );
  });

  it('still tells a timeout apart from a connection that never opened', async () => {
    globalThis.fetch = jest.fn(() => Promise.reject(new Error('Network request failed')));
    await expect(timedFetch('https://h/x', {}, asIs)).rejects.not.toThrow(NO_RESPONSE);
  });
});
