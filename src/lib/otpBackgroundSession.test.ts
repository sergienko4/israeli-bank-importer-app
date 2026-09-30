/**
 * Covers how background work gets a session with nobody there to unlock one.
 *
 * Two of these are security properties rather than conveniences. A pair renewed
 * here is saved already expired, so the screen still asks for an unlock before
 * it uses anything. And a refresh token is never presented twice, because the
 * portal reads a second presentation as a stolen copy and ends the session.
 */
import type { AppTokens } from '../api/appTokens';
import type { Connection } from '../auth/connectionStore';
import { createUnattendedSession, SAVED_EXPIRED } from './otpBackgroundSession';
import { TASK_TIMEOUT_MS } from './otpDeadline';

const NOW = 1_700_000_000_000;
const BASE_URL = 'https://importer.example.ts.net';
const FIFTEEN_MINUTES = 15 * 60_000;

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    baseUrl: BASE_URL,
    accessToken: 'access-at-unlock',
    refreshToken: 'refresh-at-unlock',
    expiresAt: NOW + FIFTEEN_MINUTES,
    ...overrides,
  };
}

/**
 * A secure store and portal that behave like the real ones: rotation retires the old token.
 * @param initial - What storage holds before the first call.
 * @returns The loader under test, its fakes, and a view of storage.
 */
function harness(initial: Connection | null) {
  let stored = initial;
  let issued = 0;
  let clock = NOW;
  const presented: string[] = [];
  const save = jest.fn((next: Connection) => {
    stored = next;
    return Promise.resolve();
  });
  const refresh = jest.fn((_baseUrl: string, refreshToken: string): Promise<AppTokens> => {
    presented.push(refreshToken);
    issued += 1;
    return Promise.resolve({
      accessToken: `access-renewed-${String(issued)}`,
      refreshToken: `refresh-renewed-${String(issued)}`,
      expiresAt: clock + FIFTEEN_MINUTES,
    });
  });
  const load = jest.fn(() => Promise.resolve(stored));
  const loader = createUnattendedSession({ load, save, refresh, now: () => clock });
  return {
    loader,
    save,
    refresh,
    presented,
    stored: () => stored,
    replaceStored: (next: Connection) => {
      stored = next;
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('loadUnattendedSession', () => {
  it('has nothing to work with when the device was never paired', async () => {
    const h = harness(null);
    await expect(h.loader()).resolves.toBeNull();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it('uses a stored token that outlasts the whole task', async () => {
    const h = harness(connection());
    await expect(h.loader()).resolves.toEqual({ baseUrl: BASE_URL, token: 'access-at-unlock' });
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it('renews an expired token without a prompt, so a closed app still answers', async () => {
    const h = harness(connection({ expiresAt: NOW - 1 }));
    await expect(h.loader()).resolves.toEqual({ baseUrl: BASE_URL, token: 'access-renewed-1' });
    expect(h.presented).toEqual(['refresh-at-unlock']);
  });

  it('renews a token that would expire before the task could finish', async () => {
    const h = harness(connection({ expiresAt: NOW + TASK_TIMEOUT_MS }));
    await expect(h.loader()).resolves.toEqual({ baseUrl: BASE_URL, token: 'access-renewed-1' });
  });

  it('saves the rotated pair already expired, so the screen still asks for an unlock', async () => {
    const h = harness(connection({ expiresAt: NOW - 1 }));
    await h.loader();
    expect(h.stored()).toEqual({
      baseUrl: BASE_URL,
      accessToken: 'access-renewed-1',
      refreshToken: 'refresh-renewed-1',
      expiresAt: SAVED_EXPIRED,
    });
  });

  it('reuses its own renewal across retries instead of spending a token each time', async () => {
    const h = harness(connection({ expiresAt: NOW - 1 }));
    await h.loader();
    await expect(h.loader()).resolves.toEqual({ baseUrl: BASE_URL, token: 'access-renewed-1' });
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it('never presents one refresh token twice when two captures overlap', async () => {
    const h = harness(connection({ expiresAt: NOW - 1 }));
    await Promise.all([h.loader(), h.loader(), h.loader()]);
    expect(h.presented).toEqual(['refresh-at-unlock']);
  });

  it('keeps using its renewal when the save failed, never replaying the spent token', async () => {
    const h = harness(connection({ expiresAt: NOW - 1 }));
    h.save.mockRejectedValueOnce(new Error('Keychain unavailable.'));
    await h.loader();
    await expect(h.loader()).resolves.toEqual({ baseUrl: BASE_URL, token: 'access-renewed-1' });
    expect(h.presented).toEqual(['refresh-at-unlock']);
  });

  it('never replays a token storage kept after two saves failed in a row', async () => {
    const h = harness(connection({ expiresAt: NOW - 1 }));
    h.save.mockRejectedValue(new Error('Keychain unavailable.'));
    await h.loader();
    h.advance(FIFTEEN_MINUTES);
    await h.loader();
    await expect(h.loader()).resolves.toEqual({ baseUrl: BASE_URL, token: 'access-renewed-2' });
    expect(h.presented).toEqual(['refresh-at-unlock', 'refresh-renewed-1']);
  });

  it('defers to a newer pair the screen saved after an unlock', async () => {
    const h = harness(connection({ expiresAt: NOW - 1 }));
    await h.loader();
    h.replaceStored(
      connection({ accessToken: 'access-unlocked', refreshToken: 'refresh-unlocked' }),
    );
    await expect(h.loader()).resolves.toEqual({ baseUrl: BASE_URL, token: 'access-unlocked' });
  });

  it('forgets its renewal once the device is unpaired', async () => {
    const h = harness(connection({ expiresAt: NOW - 1 }));
    await h.loader();
    h.replaceStored(null as unknown as Connection);
    await expect(h.loader()).resolves.toBeNull();
  });

  it('reports a refused renewal as a failure and stores nothing', async () => {
    const h = harness(connection({ expiresAt: NOW - 1 }));
    h.refresh.mockRejectedValueOnce(new Error('The importer did not respond in time.'));
    await expect(h.loader()).rejects.toThrow('did not respond');
    expect(h.save).not.toHaveBeenCalled();
  });
});
