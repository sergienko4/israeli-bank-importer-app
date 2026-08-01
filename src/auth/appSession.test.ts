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
import { authenticateBiometric } from '../lib/biometrics';
import { isExpiring, REFRESH_MARGIN_MS, refreshConnection, toSession } from './appSession';
import { type Connection, saveConnection } from './connectionStore';

jest.mock('../api/appTokens', () => ({
  ...jest.requireActual<Record<string, unknown>>('../api/appTokens'),
  refreshTokens: jest.fn(),
}));
jest.mock('../lib/biometrics', () => ({ authenticateBiometric: jest.fn() }));
jest.mock('./connectionStore', () => ({ saveConnection: jest.fn() }));

const mockedRefresh = refreshTokens as jest.MockedFunction<typeof refreshTokens>;
const mockedUnlock = authenticateBiometric as jest.MockedFunction<typeof authenticateBiometric>;
const mockedSave = saveConnection as jest.MockedFunction<typeof saveConnection>;

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

beforeEach(() => {
  jest.clearAllMocks();
  mockedUnlock.mockResolvedValue({ status: 'success' });
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
    const outcome = await refreshConnection(CONNECTION);
    expect(outcome).toEqual({ status: 'refreshed', connection: ROTATED });
    expect(mockedSave).toHaveBeenCalledTimes(1);
    expect(mockedSave).toHaveBeenCalledWith(ROTATED);
  });

  it('spends the stored refresh token against the stored address', async () => {
    await refreshConnection(CONNECTION);
    expect(mockedRefresh).toHaveBeenCalledWith(CONNECTION.baseUrl, CONNECTION.refreshToken);
  });

  it('keeps the rotated pair when the secure store refuses the write', async () => {
    mockedSave.mockRejectedValue(new Error('Keychain unavailable.'));
    const outcome = await refreshConnection(CONNECTION);
    expect(outcome).toEqual({ status: 'refreshed', connection: ROTATED });
  });
});

describe('refreshConnection when the user does not unlock', () => {
  it('does not reach the network when the prompt fails', async () => {
    mockedUnlock.mockResolvedValue({ status: 'failed' });
    const outcome = await refreshConnection(CONNECTION);
    expect(outcome.status).toBe('declined');
    expect(mockedRefresh).not.toHaveBeenCalled();
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it('ends the connection when the device has no screen lock', async () => {
    mockedUnlock.mockResolvedValue({ status: 'unsupported' });
    const outcome = await refreshConnection(CONNECTION);
    expect(outcome.status).toBe('ended');
    expect(mockedRefresh).not.toHaveBeenCalled();
  });
});

describe('the message on a terminal outcome', () => {
  // Ending the session returns the user to the connect screen, which shows this
  // message. Without one they would arrive there with no idea what happened.
  it('names the fix when the device has no screen lock', async () => {
    mockedUnlock.mockResolvedValue({ status: 'unsupported' });
    const outcome = await refreshConnection(CONNECTION);
    expect(outcome).toEqual({
      status: 'ended',
      message: 'Set up a screen lock to stay signed in.',
    });
  });

  it('says what to do when the portal retires the session', async () => {
    mockedRefresh.mockRejectedValue(new SessionEndedError());
    const outcome = await refreshConnection(CONNECTION);
    expect(outcome.status).toBe('ended');
    expect(outcome).toHaveProperty('message', SESSION_ENDED);
    expect(SESSION_ENDED).toMatch(/sign in again/i);
  });
});

describe('refreshConnection when the portal refuses', () => {
  it('treats an ended session as terminal', async () => {
    mockedRefresh.mockRejectedValue(new SessionEndedError());
    const outcome = await refreshConnection(CONNECTION);
    expect(outcome.status).toBe('ended');
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it('keeps the session when something merely worded like an ended one arrives', async () => {
    // A 401 from any endpoint is worded "sign in again" too. Deciding
    // terminality by reading the sentence would sign the user out for a
    // failure a retry would have fixed.
    mockedRefresh.mockRejectedValue(new Error(SESSION_ENDED));
    const outcome = await refreshConnection(CONNECTION);
    expect(outcome.status).toBe('declined');
  });

  it('treats a rate limit as worth retrying later', async () => {
    mockedRefresh.mockRejectedValue(new Error('Too many attempts. Wait a minute, then try again.'));
    const outcome = await refreshConnection(CONNECTION);
    expect(outcome.status).toBe('declined');
  });

  it('treats a server error as worth retrying later', async () => {
    mockedRefresh.mockRejectedValue(new Error('The importer is not answering right now.'));
    const outcome = await refreshConnection(CONNECTION);
    expect(outcome.status).toBe('declined');
  });

  it('survives a rejection that is not an Error', async () => {
    mockedRefresh.mockRejectedValue('nope');
    const outcome = await refreshConnection(CONNECTION);
    expect(outcome).toEqual({ status: 'declined', message: 'Could not reconnect. Try again.' });
  });
});
