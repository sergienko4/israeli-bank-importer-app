/**
 * Proves the store keeps what the app needs and drops what it must not keep.
 *
 * Two things matter here. A connection written by an older version must read as
 * "not connected" rather than as a half-usable session, and the portal password
 * that older version stored must be gone after launch — a credential nobody can
 * revoke is worse than one that simply expires.
 */
import * as SecureStore from 'expo-secure-store';

import {
  clearConnection,
  type Connection,
  loadConnection,
  migrateLegacySecrets,
  saveConnection,
} from './connectionStore';

jest.mock('expo-secure-store');

const mocked = SecureStore as jest.Mocked<typeof SecureStore>;

const V1_KEY = 'importer.connection.v1';
const V2_KEY = 'importer.connection.v2';
const PASSWORD_KEY = 'importer.password.v1';

const CONNECTION: Connection = {
  baseUrl: 'https://importer.example.ts.net',
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: 1_700_000_000_000,
};

/**
 * Backs the secure-store mock with a plain record for the current test.
 * @returns The record the mock reads from and writes to.
 */
function wireSecureStore(): Record<string, string> {
  const store: Record<string, string> = {};
  mocked.setItemAsync.mockImplementation(async (key: string, value: string) => {
    store[key] = value;
  });
  mocked.getItemAsync.mockImplementation(async (key: string) => store[key] ?? null);
  mocked.deleteItemAsync.mockImplementation(async (key: string) => {
    delete store[key];
  });
  return store;
}

describe('connectionStore', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = wireSecureStore();
  });

  it('round-trips a saved connection', async () => {
    await saveConnection(CONNECTION);
    await expect(loadConnection()).resolves.toEqual(CONNECTION);
  });

  it('returns null when nothing is stored', async () => {
    await expect(loadConnection()).resolves.toBeNull();
  });

  it('returns null on a corrupt entry', async () => {
    store[V2_KEY] = 'not-json';
    await expect(loadConnection()).resolves.toBeNull();
  });

  it.each([
    ['no address', { accessToken: 'a', refreshToken: 'r', expiresAt: 1 }],
    ['no access token', { baseUrl: 'https://h', refreshToken: 'r', expiresAt: 1 }],
    ['no refresh token', { baseUrl: 'https://h', accessToken: 'a', expiresAt: 1 }],
    ['no expiry', { baseUrl: 'https://h', accessToken: 'a', refreshToken: 'r' }],
    [
      'a non-numeric expiry',
      { baseUrl: 'https://h', accessToken: 'a', refreshToken: 'r', expiresAt: '1' },
    ],
    ['the old v1 shape', { baseUrl: 'https://h', token: 't' }],
  ])('returns null for an entry with %s', async (_label, entry) => {
    store[V2_KEY] = JSON.stringify(entry);
    await expect(loadConnection()).resolves.toBeNull();
  });

  it('ignores a connection left by the previous version', async () => {
    store[V1_KEY] = JSON.stringify({ baseUrl: 'https://h', token: 't' });
    await expect(loadConnection()).resolves.toBeNull();
  });

  it('clears a stored connection', async () => {
    await saveConnection(CONNECTION);
    await clearConnection();
    await expect(loadConnection()).resolves.toBeNull();
  });

  it('clears every key the app has ever written', async () => {
    await saveConnection(CONNECTION);
    store[V1_KEY] = JSON.stringify({ baseUrl: 'https://h', token: 't' });
    store[PASSWORD_KEY] = 'secret';
    await clearConnection();
    expect(Object.keys(store)).toHaveLength(0);
  });
});

describe('migrateLegacySecrets', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = wireSecureStore();
  });

  it('removes the stored portal password', async () => {
    store[PASSWORD_KEY] = 'secret';
    await migrateLegacySecrets();
    expect(store[PASSWORD_KEY]).toBeUndefined();
  });

  it('removes the previous connection entry', async () => {
    store[V1_KEY] = JSON.stringify({ baseUrl: 'https://h', token: 't' });
    await migrateLegacySecrets();
    expect(store[V1_KEY]).toBeUndefined();
  });

  it('leaves the current connection alone', async () => {
    await saveConnection(CONNECTION);
    await migrateLegacySecrets();
    await expect(loadConnection()).resolves.toEqual(CONNECTION);
  });

  it('is safe to run twice', async () => {
    store[PASSWORD_KEY] = 'secret';
    await migrateLegacySecrets();
    await expect(migrateLegacySecrets()).resolves.toBeUndefined();
  });
});
