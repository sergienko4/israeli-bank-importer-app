/**
 * Covers how background work gets a session with nobody there to unlock one.
 *
 * Two of these are security properties rather than conveniences. A pair renewed
 * here is saved already expired, so the screen still asks for an unlock before
 * it uses anything. And a refresh token is never presented twice, because the
 * portal reads a second presentation as a stolen copy and ends the session.
 */
import { type AppTokens, refreshTokens } from '../api/appTokens';
import { NO_RESPONSE } from '../api/timedFetch';
import { type Connection, loadConnection } from '../auth/connectionStore';
import { createTokenLedger, processLedger } from '../auth/tokenLedger';
import { loadBackgroundCaptureAllowed } from './otpBackgroundGate';
import {
  createUnattendedSession,
  loadUnattendedSession,
  SAVED_EXPIRED,
  WITHHELD_ACCESS,
} from './otpBackgroundSession';
import { TASK_TIMEOUT_MS } from './otpDeadline';

jest.mock('../api/appTokens', () => ({
  ...jest.requireActual<Record<string, unknown>>('../api/appTokens'),
  refreshTokens: jest.fn(),
}));
jest.mock('../auth/connectionStore', () => ({
  clearConnection: jest.fn(),
  loadConnection: jest.fn(),
  saveConnection: jest.fn(),
}));
jest.mock('./otpBackgroundGate', () => ({ loadBackgroundCaptureAllowed: jest.fn() }));

const mockedRefresh = refreshTokens as jest.MockedFunction<typeof refreshTokens>;
const mockedLoad = loadConnection as jest.MockedFunction<typeof loadConnection>;
const mockedAllowed = loadBackgroundCaptureAllowed as jest.MockedFunction<
  typeof loadBackgroundCaptureAllowed
>;

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
  let allowed = true;
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
  const start = () =>
    createUnattendedSession({
      allowed: () => Promise.resolve(allowed),
      load,
      save,
      refresh,
      now: () => clock,
      ledger: createTokenLedger(),
    });
  return {
    loader: start(),
    restart: start,
    load,
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
    switchOff: () => {
      allowed = false;
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

  it('saves the rotated pair withheld, so a cancelled unlock has nothing to send', async () => {
    const h = harness(connection({ expiresAt: NOW - 1 }));
    await h.loader();
    expect(h.stored()).toEqual({
      baseUrl: BASE_URL,
      accessToken: WITHHELD_ACCESS,
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

  it('repairs storage from its renewal, so a restart never replays the spent token', async () => {
    const h = harness(connection({ expiresAt: NOW - 1 }));
    h.save.mockRejectedValueOnce(new Error('Keychain unavailable.'));
    await h.loader();
    await h.loader();
    h.advance(FIFTEEN_MINUTES);
    await expect(h.restart()()).resolves.toEqual({ baseUrl: BASE_URL, token: 'access-renewed-2' });
    expect(h.presented).toEqual(['refresh-at-unlock', 'refresh-renewed-1']);
  });

  it('keeps answering from its renewal while storage still cannot be repaired', async () => {
    const h = harness(connection({ expiresAt: NOW - 1 }));
    h.save.mockRejectedValue(new Error('Keychain unavailable.'));
    await h.loader();
    await expect(h.loader()).resolves.toEqual({ baseUrl: BASE_URL, token: 'access-renewed-1' });
    expect(h.presented).toEqual(['refresh-at-unlock']);
  });

  it('writes nothing when storage already holds the live token', async () => {
    const h = harness(connection());
    await h.loader();
    await h.loader();
    expect(h.save).not.toHaveBeenCalled();
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

  it('spends nothing for a user who has switched capture off', async () => {
    const h = harness(connection({ expiresAt: NOW - 1 }));
    h.switchOff();
    await expect(h.loader()).resolves.toBeNull();
    expect(h.load).not.toHaveBeenCalled();
    expect(h.refresh).not.toHaveBeenCalled();
    expect(h.save).not.toHaveBeenCalled();
  });

  it('hands out not even a live token while capture is switched off', async () => {
    const h = harness(connection());
    h.switchOff();
    await expect(h.loader()).resolves.toBeNull();
  });

  it('reports a refused renewal as a failure and stores nothing', async () => {
    const h = harness(connection({ expiresAt: NOW - 1 }));
    h.refresh.mockRejectedValueOnce(new Error('The importer did not respond in time.'));
    await expect(h.loader()).rejects.toThrow('did not respond');
    expect(h.save).not.toHaveBeenCalled();
  });

  it('answers in time, then keeps the late pair and hands it out next', async () => {
    // The portal retired the presented token on accepting the request, so the
    // late reply holds the only live one; the next capture must not replay.
    jest.useFakeTimers({ doNotFake: ['Date'] });
    try {
      const h = harness(connection({ expiresAt: NOW - 1 }));
      h.refresh.mockImplementationOnce(
        (_baseUrl, refreshToken) =>
          new Promise((resolve) => {
            h.presented.push(refreshToken);
            setTimeout(() => {
              resolve({
                accessToken: 'access-late',
                refreshToken: 'refresh-late',
                expiresAt: NOW + FIFTEEN_MINUTES,
              });
            }, 20_000);
          }),
      );
      const first = expect(h.loader()).rejects.toThrow(NO_RESPONSE);
      await jest.advanceTimersByTimeAsync(15_000);
      await first;
      const next = h.loader();
      await jest.advanceTimersByTimeAsync(5_000);
      await expect(next).resolves.toEqual({ baseUrl: BASE_URL, token: 'access-late' });
      expect(h.presented).toEqual(['refresh-at-unlock']);
      expect(h.stored()).toHaveProperty('refreshToken', 'refresh-late');
    } finally {
      await jest.runOnlyPendingTimersAsync();
      jest.useRealTimers();
    }
  });
});

describe('loadUnattendedSession as every background path receives it', () => {
  beforeEach(() => {
    processLedger.forget();
    mockedLoad.mockResolvedValue(connection({ expiresAt: NOW - 1 }));
    mockedRefresh.mockResolvedValue({
      accessToken: 'access-renewed',
      refreshToken: 'refresh-renewed',
      expiresAt: Date.now() + FIFTEEN_MINUTES,
    });
  });

  it('checks the capture switches before spending the refresh token', async () => {
    mockedAllowed.mockResolvedValue(false);
    await expect(loadUnattendedSession()).resolves.toBeNull();
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it('renews once the switches allow it', async () => {
    mockedAllowed.mockResolvedValue(true);
    await expect(loadUnattendedSession()).resolves.toEqual({
      baseUrl: BASE_URL,
      token: 'access-renewed',
    });
    expect(mockedRefresh).toHaveBeenCalledWith(BASE_URL, 'refresh-at-unlock');
  });
});
