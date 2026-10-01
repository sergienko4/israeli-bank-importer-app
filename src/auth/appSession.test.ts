/**
 * Proves the rules that decide when to spend a refresh token and what a failure
 * means.
 *
 * Two of these are security properties rather than conveniences. The biometric
 * prompt is fail-closed, so a declined or failed unlock must never reach the
 * network with a refresh token. And a session the portal has ended must be
 * reported as ended rather than retried, because a client that keeps knocking
 * defeats the point of revoking a device.
 */
import { refreshTokens, SESSION_ENDED, SessionEndedError } from '../api/appTokens';
import { NO_RESPONSE } from '../api/timedFetch';
import { authenticateBiometric } from '../lib/biometrics';
import { forgetHeldMessages } from '../lib/otpStashGate';
import {
  adoptConnection,
  dropConnection,
  isExpiring,
  NO_LONGER_PAIRED,
  REFRESH_MARGIN_MS,
  refreshConnection,
  type RefreshOutcome,
  STORAGE_DAMAGED,
  STORAGE_UNREADABLE,
  toSession,
} from './appSession';
import {
  clearConnection,
  type Connection,
  readConnection,
  saveConnection,
} from './connectionStore';
import { currentPairing } from './pairingGeneration';
import { withRefreshLock } from './refreshLock';
import { processLedger } from './tokenLedger';

jest.mock('../api/appTokens', () => ({
  ...jest.requireActual<Record<string, unknown>>('../api/appTokens'),
  refreshTokens: jest.fn(),
}));
jest.mock('../lib/biometrics', () => ({ authenticateBiometric: jest.fn() }));
jest.mock('../lib/otpStashGate', () => ({ forgetHeldMessages: jest.fn() }));
jest.mock('./connectionStore', () => ({
  clearConnection: jest.fn(),
  readConnection: jest.fn(),
  saveConnection: jest.fn(),
}));

const mockedRefresh = refreshTokens as jest.MockedFunction<typeof refreshTokens>;
const mockedUnlock = authenticateBiometric as jest.MockedFunction<typeof authenticateBiometric>;
const mockedRead = readConnection as jest.MockedFunction<typeof readConnection>;
const mockedSave = saveConnection as jest.MockedFunction<typeof saveConnection>;
const mockedClear = clearConnection as jest.MockedFunction<typeof clearConnection>;
const mockedForgetHeld = forgetHeldMessages as jest.MockedFunction<typeof forgetHeldMessages>;

const CONNECTION: Connection = {
  baseUrl: 'https://importer.example.ts.net',
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: 2_000_000_000_000,
};

const ROTATED: Connection = {
  baseUrl: CONNECTION.baseUrl,
  accessToken: 'access-2',
  refreshToken: 'refresh-2',
  expiresAt: 2_000_000_900_000,
};

const SIGNED_IN_ELSEWHERE: Connection = { ...CONNECTION, refreshToken: 'refresh-elsewhere' };

beforeEach(() => {
  jest.clearAllMocks();
  processLedger.forget();
  mockedUnlock.mockResolvedValue({ status: 'success' });
  mockedRead.mockResolvedValue({ state: 'paired', connection: CONNECTION });
  mockedSave.mockResolvedValue();
  mockedClear.mockResolvedValue();
  mockedForgetHeld.mockResolvedValue();
  mockedRefresh.mockResolvedValue({
    accessToken: 'access-2',
    refreshToken: 'refresh-2',
    expiresAt: 2_000_000_900_000,
  });
});

describe('toSession', () => {
  it('exposes only the address and the bearer', () => {
    expect(toSession(CONNECTION)).toEqual({
      baseUrl: CONNECTION.baseUrl,
      token: CONNECTION.accessToken,
    });
  });
});

describe('isExpiring', () => {
  it('is false while there is comfortably time left', () => {
    expect(isExpiring(CONNECTION, CONNECTION.expiresAt - REFRESH_MARGIN_MS - 1)).toBe(false);
  });

  it('is true once inside the margin', () => {
    expect(isExpiring(CONNECTION, CONNECTION.expiresAt - REFRESH_MARGIN_MS + 1)).toBe(true);
  });

  it('is true for a token that already expired', () => {
    expect(isExpiring(CONNECTION, CONNECTION.expiresAt + 1)).toBe(true);
  });
});

describe('refreshConnection when the user unlocks', () => {
  it('rotates the tokens and stores the result', async () => {
    const outcome = await refreshConnection();
    expect(outcome).toEqual({ status: 'refreshed', connection: ROTATED });
    expect(mockedSave).toHaveBeenCalledTimes(1);
    expect(mockedSave).toHaveBeenCalledWith(ROTATED);
  });

  it('spends the stored refresh token against the stored address', async () => {
    await refreshConnection();
    expect(mockedRefresh).toHaveBeenCalledWith(CONNECTION.baseUrl, CONNECTION.refreshToken);
  });

  it('keeps the rotated pair when the secure store refuses the write', async () => {
    mockedSave.mockRejectedValue(new Error('Keychain unavailable.'));
    const outcome = await refreshConnection();
    expect(outcome).toEqual({ status: 'refreshed', connection: ROTATED });
  });

  it('spends the stored refresh token, not the one the screen loaded at launch', async () => {
    // The background capture renewed while the screen held its copy, retiring
    // that copy's refresh token. Presenting it again would read as a stolen copy
    // and end the whole session.
    mockedRead.mockResolvedValue({
      state: 'paired',
      connection: { ...CONNECTION, refreshToken: 'refresh-background' },
    });
    await refreshConnection();
    expect(mockedRefresh).toHaveBeenCalledWith(CONNECTION.baseUrl, 'refresh-background');
    expect(mockedRefresh).not.toHaveBeenCalledWith(CONNECTION.baseUrl, CONNECTION.refreshToken);
  });

  it('declines without spending a token when storage cannot be read', async () => {
    // The screen's copy may belong to a pairing a newer sign-in replaced while
    // this renewal waited, and renewing it would save that pairing back.
    mockedRead.mockRejectedValue(new Error('Keychain unavailable.'));
    const outcome = await refreshConnection();
    expect(outcome).toEqual({ status: 'declined', message: STORAGE_UNREADABLE });
    expect(mockedRefresh).not.toHaveBeenCalled();
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it('does not pair the device again once storage holds nothing', async () => {
    // Disconnect ran while this renewal waited its turn; spending the screen's
    // copy now would quietly restore the pairing the user just removed.
    mockedRead.mockResolvedValue({ state: 'empty' });
    const outcome = await refreshConnection();
    expect(outcome).toEqual({
      status: 'ended',
      message: NO_LONGER_PAIRED,
      pairing: expect.any(Number) as number,
    });
    expect(mockedRefresh).not.toHaveBeenCalled();
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it('ends a damaged pairing with its own reason, without spending a token', async () => {
    // Launch already reads a damaged entry as "not connected", and no retry can
    // repair it, so the renewal ends it; saying the device was disconnected
    // would send the user looking for a Disconnect nobody pressed.
    mockedRead.mockResolvedValue({ state: 'damaged' });
    const outcome = await refreshConnection();
    expect(outcome).toEqual({
      status: 'ended',
      message: STORAGE_DAMAGED,
      pairing: expect.any(Number) as number,
    });
    expect(mockedRefresh).not.toHaveBeenCalled();
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it('renews from its own pair when its save failed, never replaying the spent token', async () => {
    mockedSave.mockRejectedValueOnce(new Error('Keychain unavailable.'));
    await refreshConnection();
    mockedRefresh.mockResolvedValueOnce({
      accessToken: 'access-3',
      refreshToken: 'refresh-3',
      expiresAt: 2_000_001_800_000,
    });
    await refreshConnection();
    expect(mockedRefresh.mock.calls.map(([, token]) => token)).toEqual(['refresh-1', 'refresh-2']);
  });

  it('renews from the background pair when the background could not save it', async () => {
    const background: Connection = { ...ROTATED, refreshToken: 'refresh-background' };
    processLedger.record(CONNECTION, background);
    await refreshConnection();
    expect(mockedRefresh).toHaveBeenCalledWith(CONNECTION.baseUrl, 'refresh-background');
  });
});

describe('adoptConnection and dropConnection', () => {
  it('stores a new sign-in and forgets renewals of the old pairing', async () => {
    processLedger.record(CONNECTION, ROTATED);
    const signedIn: Connection = { ...CONNECTION, refreshToken: 'refresh-signed-in' };
    await adoptConnection(signedIn);
    expect(mockedSave).toHaveBeenCalledWith(signedIn);
    expect(processLedger.current(CONNECTION)).toEqual(CONNECTION);
  });

  it('removes the pairing and forgets renewals of it', async () => {
    processLedger.record(CONNECTION, ROTATED);
    await dropConnection();
    expect(mockedClear).toHaveBeenCalledTimes(1);
    expect(processLedger.current(CONNECTION)).toEqual(CONNECTION);
  });

  it.each([
    ['sign-in', () => adoptConnection(CONNECTION)],
    ['disconnect', () => dropConnection()],
  ])('waits for a renewal in flight before a %s touches storage', async (_label, act) => {
    const order: string[] = [];
    let finish: () => void = () => undefined;
    const renewal = withRefreshLock(async () => {
      order.push('renewal:start');
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      order.push('renewal:saved');
    });
    mockedSave.mockImplementation(() => {
      order.push('storage');
      return Promise.resolve();
    });
    mockedClear.mockImplementation(() => {
      order.push('storage');
      return Promise.resolve();
    });
    const replaced = act();
    await Promise.resolve();
    finish();
    await Promise.all([renewal, replaced]);
    expect(order).toEqual(['renewal:start', 'renewal:saved', 'storage']);
  });
});

/**
 * Narrows an outcome to an ended one, failing the test otherwise.
 * @param outcome - What the renewal reported.
 * @returns The ended outcome, carrying the pairing it judged.
 */
function ended(outcome: RefreshOutcome): Extract<RefreshOutcome, { status: 'ended' }> {
  if (outcome.status !== 'ended') throw new Error(`Expected ended, got ${outcome.status}.`);
  return outcome;
}

describe('dropConnection after a renewal ended', () => {
  const SIGNED_IN: Connection = { ...CONNECTION, refreshToken: 'refresh-signed-in' };

  it('spares a sign-in that queued behind the renewal before its drop ran', async () => {
    // The screen learns the old pairing ended only once the renewal returns,
    // and a sign-in already waiting on the lock saves its pairing first. A drop
    // that cleared storage then would remove the pairing the user just made.
    let refuse: (error: Error) => void = () => undefined;
    mockedRefresh.mockReturnValue(
      new Promise((_resolve, reject) => {
        refuse = reject;
      }),
    );
    const renewal = refreshConnection();
    await new Promise<void>((resolve) => {
      setImmediate(() => {
        resolve();
      });
    });
    const signIn = adoptConnection(SIGNED_IN);
    refuse(new SessionEndedError());
    const outcome = ended(await renewal);
    await signIn;
    await expect(dropConnection(outcome.pairing)).resolves.toBe(false);
    expect(mockedClear).not.toHaveBeenCalled();
  });

  it.each([
    ['the portal retired it', () => mockedRefresh.mockRejectedValue(new SessionEndedError())],
    ['the device was unpaired', () => mockedRead.mockResolvedValue({ state: 'empty' })],
    ['the saved pairing is damaged', () => mockedRead.mockResolvedValue({ state: 'damaged' })],
    [
      'the device has no screen lock',
      () => mockedUnlock.mockResolvedValue({ status: 'unsupported' }),
    ],
  ])('removes the pairing when %s and nothing replaced it', async (_label, arrange) => {
    arrange();
    const outcome = ended(await refreshConnection());
    await expect(dropConnection(outcome.pairing)).resolves.toBe(true);
    expect(mockedClear).toHaveBeenCalledTimes(1);
  });

  it('removes whatever is paired when the user disconnects', async () => {
    mockedRefresh.mockRejectedValue(new SessionEndedError());
    await refreshConnection();
    await adoptConnection(SIGNED_IN);
    await expect(dropConnection()).resolves.toBe(true);
    expect(mockedClear).toHaveBeenCalledTimes(1);
  });
});

describe('held messages across a pairing change', () => {
  /**
   * Records storage writes, held-message clears, and work queued on the lock.
   * @returns The order the steps ran in.
   */
  function recordOrder(): string[] {
    const order: string[] = [];
    mockedSave.mockImplementation(() => {
      order.push('storage');
      return Promise.resolve();
    });
    mockedClear.mockImplementation(() => {
      order.push('storage');
      return Promise.resolve();
    });
    mockedForgetHeld.mockImplementation(() => {
      order.push('held:forgotten');
      return Promise.resolve();
    });
    return order;
  }

  it.each([
    ['a sign-in is stored', () => adoptConnection(CONNECTION)],
    ['the user disconnects', () => dropConnection()],
  ])('forgets them once %s, before the lock is free', async (_label, act) => {
    // A message held before the change was captured for the pairing it ended.
    // Clearing after the lock frees would let a drain that queued behind the
    // change spend such a code against the new pairing.
    const order = recordOrder();
    const change = act();
    const next = withRefreshLock(() => {
      order.push('next-on-lock');
      return Promise.resolve();
    });
    await Promise.all([change, next]);
    expect(order).toEqual(['storage', 'held:forgotten', 'next-on-lock']);
  });

  it('forgets them when an ended renewal drops its own pairing', async () => {
    mockedRefresh.mockRejectedValue(new SessionEndedError());
    const outcome = ended(await refreshConnection());
    await dropConnection(outcome.pairing);
    expect(mockedForgetHeld).toHaveBeenCalledTimes(1);
  });

  it('leaves them to the newer sign-in when a stale drop spares it', async () => {
    // The sign-in already cleared what the old pairing held; anything held
    // since then was captured for the pairing the drop is sparing.
    mockedRefresh.mockRejectedValue(new SessionEndedError());
    const outcome = ended(await refreshConnection());
    await adoptConnection(SIGNED_IN_ELSEWHERE);
    mockedForgetHeld.mockClear();
    await expect(dropConnection(outcome.pairing)).resolves.toBe(false);
    expect(mockedForgetHeld).not.toHaveBeenCalled();
  });

  it('keeps them when the sign-in could not be stored', async () => {
    mockedSave.mockRejectedValue(new Error('Keychain unavailable.'));
    await expect(adoptConnection(CONNECTION)).rejects.toThrow('Keychain unavailable.');
    expect(mockedForgetHeld).not.toHaveBeenCalled();
  });
});

describe('the pairing number a background send is checked against', () => {
  /**
   * Records the pairing number each storage write and held-message clear saw.
   * @returns The number seen at each step, in the order the steps ran.
   */
  function recordNumbers(): number[] {
    const seen: number[] = [];
    const note = (): Promise<void> => {
      seen.push(currentPairing());
      return Promise.resolve();
    };
    mockedSave.mockImplementation(note);
    mockedClear.mockImplementation(note);
    mockedForgetHeld.mockImplementation(note);
    return seen;
  }

  it.each([
    ['a sign-in', () => adoptConnection(SIGNED_IN_ELSEWHERE)],
    ['a Disconnect', () => dropConnection()],
  ])('changes before %s touches storage', async (_label, act) => {
    // A send that starts while the change is being stored must already see
    // it, or it would go over the session the change is replacing.
    const before = currentPairing();
    const seen = recordNumbers();
    await act();
    expect(seen).toHaveLength(2);
    expect(seen.every((number) => number !== before)).toBe(true);
  });

  it('changes even when the sign-in could not be stored', async () => {
    // Refusing a send for a pairing that turned out to stay costs the user one
    // typed code; sending for one that did not stay can reach the wrong importer.
    const before = currentPairing();
    mockedSave.mockRejectedValue(new Error('Keychain unavailable.'));
    await expect(adoptConnection(SIGNED_IN_ELSEWHERE)).rejects.toThrow('Keychain unavailable.');
    expect(currentPairing()).not.toBe(before);
  });

  it('stays the same when a stale drop spares a newer sign-in', async () => {
    mockedRefresh.mockRejectedValue(new SessionEndedError());
    const outcome = ended(await refreshConnection());
    await adoptConnection(SIGNED_IN_ELSEWHERE);
    const afterSignIn = currentPairing();
    await expect(dropConnection(outcome.pairing)).resolves.toBe(false);
    expect(currentPairing()).toBe(afterSignIn);
  });

  it('stays the same when the screen renews the pairing it already has', async () => {
    const before = currentPairing();
    await expect(refreshConnection()).resolves.toMatchObject({ status: 'refreshed' });
    expect(currentPairing()).toBe(before);
  });
});

describe('refreshConnection when the reply is late', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(async () => {
    // A renewal still waiting on a fake timer would hold the shared lock and
    // stall every later test.
    await jest.runOnlyPendingTimersAsync();
    jest.useRealTimers();
  });

  it('answers in time, then saves the late pair and renews from it', async () => {
    // The portal retired refresh-1 when it accepted the request, so the late
    // reply holds the only live token; renewing from refresh-1 again would end
    // the whole session.
    mockedRefresh.mockReturnValueOnce(
      new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            accessToken: 'access-2',
            refreshToken: 'refresh-2',
            expiresAt: 2_000_000_900_000,
          });
        }, 20_000);
      }),
    );
    const first = refreshConnection();
    await jest.advanceTimersByTimeAsync(15_000);
    await expect(first).resolves.toEqual({ status: 'declined', message: NO_RESPONSE });
    expect(mockedSave).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(5_000);
    expect(mockedSave).toHaveBeenCalledWith(ROTATED);
    await refreshConnection();
    expect(mockedRefresh.mock.calls.map(([, token]) => token)).toEqual(['refresh-1', 'refresh-2']);
  });
});

describe('refreshConnection when the user does not unlock', () => {
  it('does not reach the network when the prompt fails', async () => {
    mockedUnlock.mockResolvedValue({ status: 'failed' });
    const outcome = await refreshConnection();
    expect(outcome.status).toBe('declined');
    expect(mockedRefresh).not.toHaveBeenCalled();
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it('ends the connection when the device has no screen lock', async () => {
    mockedUnlock.mockResolvedValue({ status: 'unsupported' });
    const outcome = await refreshConnection();
    expect(outcome.status).toBe('ended');
    expect(mockedRefresh).not.toHaveBeenCalled();
  });
});

describe('the message on a terminal outcome', () => {
  // Ending the session returns the user to the connect screen, which shows this
  // message. Without one they would arrive there with no idea what happened.
  it('names the fix when the device has no screen lock', async () => {
    mockedUnlock.mockResolvedValue({ status: 'unsupported' });
    const outcome = await refreshConnection();
    expect(outcome).toEqual({
      status: 'ended',
      message: 'Set up a screen lock to stay signed in.',
      pairing: expect.any(Number) as number,
    });
  });

  it('says what to do when the portal retires the session', async () => {
    mockedRefresh.mockRejectedValue(new SessionEndedError());
    const outcome = await refreshConnection();
    expect(outcome.status).toBe('ended');
    expect(outcome).toHaveProperty('message', SESSION_ENDED);
    expect(SESSION_ENDED).toMatch(/sign in again/i);
  });
});

describe('refreshConnection when the portal refuses', () => {
  it('treats an ended session as terminal', async () => {
    mockedRefresh.mockRejectedValue(new SessionEndedError());
    const outcome = await refreshConnection();
    expect(outcome.status).toBe('ended');
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it('keeps the session when something merely worded like an ended one arrives', async () => {
    // A 401 from any endpoint is worded "sign in again" too. Deciding
    // terminality by reading the sentence would sign the user out for a
    // failure a retry would have fixed.
    mockedRefresh.mockRejectedValue(new Error(SESSION_ENDED));
    const outcome = await refreshConnection();
    expect(outcome.status).toBe('declined');
  });

  it('treats a rate limit as worth retrying later', async () => {
    mockedRefresh.mockRejectedValue(new Error('Too many attempts. Wait a minute, then try again.'));
    const outcome = await refreshConnection();
    expect(outcome.status).toBe('declined');
  });

  it('treats a server error as worth retrying later', async () => {
    mockedRefresh.mockRejectedValue(new Error('The importer is not answering right now.'));
    const outcome = await refreshConnection();
    expect(outcome.status).toBe('declined');
  });

  it('survives a rejection that is not an Error', async () => {
    mockedRefresh.mockRejectedValue('nope');
    const outcome = await refreshConnection();
    expect(outcome).toEqual({ status: 'declined', message: 'Could not reconnect. Try again.' });
  });
});
