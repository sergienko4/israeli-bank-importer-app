import * as SecureStore from 'expo-secure-store';

import { clearConnection, loadConnection, saveConnection } from './connectionStore';

jest.mock('expo-secure-store');

const mocked = SecureStore as jest.Mocked<typeof SecureStore>;

describe('connectionStore', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    mocked.setItemAsync.mockImplementation(async (key: string, value: string) => {
      store[key] = value;
    });
    mocked.getItemAsync.mockImplementation(async (key: string) => store[key] ?? null);
    mocked.deleteItemAsync.mockImplementation(async (key: string) => {
      delete store[key];
    });
  });

  it('round-trips a saved connection', async () => {
    await saveConnection({ baseUrl: 'http://h:8080', token: 't' });
    await expect(loadConnection()).resolves.toEqual({ baseUrl: 'http://h:8080', token: 't' });
  });

  it('returns null when nothing is stored', async () => {
    await expect(loadConnection()).resolves.toBeNull();
  });

  it('returns null on a corrupt entry', async () => {
    store['importer.connection.v1'] = 'not-json';
    await expect(loadConnection()).resolves.toBeNull();
  });

  it('clears a stored connection', async () => {
    await saveConnection({ baseUrl: 'http://h:8080', token: 't' });
    await clearConnection();
    await expect(loadConnection()).resolves.toBeNull();
  });
});
