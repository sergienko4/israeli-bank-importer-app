/**
 * Proves the auto-read preference is safe by default and safe when broken.
 *
 * This boolean decides whether the app will read incoming messages at all, so
 * the only acceptable failure direction is off. Each test pins that direction
 * for a different kind of breakage.
 */
import * as SecureStore from 'expo-secure-store';

import { loadOtpAutoRead, saveOtpAutoRead } from './otpAutoReadStore';

jest.mock('expo-secure-store');

const mocked = SecureStore as jest.Mocked<typeof SecureStore>;

const KEY = 'otp.autoRead.v1';

/**
 * Backs the secure-store mock with a plain record for the current test.
 * @returns The record the mock reads from and writes to.
 */
function wireSecureStore(): Record<string, string> {
  const store: Record<string, string> = {};
  mocked.setItemAsync.mockImplementation((key: string, value: string) => {
    store[key] = value;
    return Promise.resolve();
  });
  mocked.getItemAsync.mockImplementation((key: string) => Promise.resolve(store[key] ?? null));
  return store;
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('loadOtpAutoRead', () => {
  it('is off on a fresh install, so no message is read without a choice', async () => {
    wireSecureStore();

    await expect(loadOtpAutoRead()).resolves.toBe(false);
  });

  it('is on once the user has enabled it', async () => {
    wireSecureStore();
    await saveOtpAutoRead(true);

    await expect(loadOtpAutoRead()).resolves.toBe(true);
  });

  it('is off again once the user has disabled it', async () => {
    wireSecureStore();
    await saveOtpAutoRead(true);
    await saveOtpAutoRead(false);

    await expect(loadOtpAutoRead()).resolves.toBe(false);
  });

  it('treats a value it does not recognise as off', async () => {
    const store = wireSecureStore();
    store[KEY] = 'yes';

    await expect(loadOtpAutoRead()).resolves.toBe(false);
  });

  it('reads as off when the keystore cannot be opened', async () => {
    mocked.getItemAsync.mockRejectedValue(new Error('keystore locked'));

    await expect(loadOtpAutoRead()).resolves.toBe(false);
  });
});

describe('saveOtpAutoRead', () => {
  it('surfaces a failed write instead of silently dropping it', async () => {
    mocked.setItemAsync.mockRejectedValue(new Error('keystore locked'));

    await expect(saveOtpAutoRead(true)).rejects.toThrow('keystore locked');
  });
});
