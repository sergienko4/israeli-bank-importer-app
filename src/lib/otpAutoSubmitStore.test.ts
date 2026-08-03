/**
 * Proves the auto-submit preference is safe by default and safe when broken.
 *
 * This one boolean decides whether a code can leave the device without the user
 * pressing anything, so the only acceptable failure direction is off. Every
 * test here exists to pin that direction: an absent entry, a corrupt entry, a
 * value written by some future version, and an unreadable secure store must all
 * read as "off" rather than as "on" or a crash at launch.
 */
import * as SecureStore from 'expo-secure-store';

import { loadOtpAutoSubmit, saveOtpAutoSubmit } from './otpAutoSubmitStore';

jest.mock('expo-secure-store');

const mocked = SecureStore as jest.Mocked<typeof SecureStore>;

const KEY = 'otp.autoSubmit.v1';

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
  return store;
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('loadOtpAutoSubmit', () => {
  it('is off on a fresh install, so the app behaves exactly as before', async () => {
    wireSecureStore();
    await expect(loadOtpAutoSubmit()).resolves.toBe(false);
  });

  it('is on only after the user turned it on', async () => {
    wireSecureStore();
    await saveOtpAutoSubmit(true);
    await expect(loadOtpAutoSubmit()).resolves.toBe(true);
  });

  it('is off again after the user turned it off', async () => {
    wireSecureStore();
    await saveOtpAutoSubmit(true);
    await saveOtpAutoSubmit(false);
    await expect(loadOtpAutoSubmit()).resolves.toBe(false);
  });

  it.each(['false', 'TRUE', 'True', '1', 'yes', '', 'null', '{"enabled":true}'])(
    'reads %p as off, so only the exact stored marker enables it',
    async (stored) => {
      const store = wireSecureStore();
      store[KEY] = stored;
      await expect(loadOtpAutoSubmit()).resolves.toBe(false);
    },
  );

  it('is off when the secure store cannot be read', async () => {
    // A locked or corrupt keystore must not fail open, and must not crash the
    // OTP sheet at the moment the user is trying to enter a code by hand.
    mocked.getItemAsync.mockRejectedValue(new Error('keystore unavailable'));
    await expect(loadOtpAutoSubmit()).resolves.toBe(false);
  });
});

describe('saveOtpAutoSubmit', () => {
  it('reports a write failure instead of silently keeping the old value', async () => {
    // Swallowing this would be dangerous in one direction: a user who turns
    // auto-submit OFF and is not told the write failed would believe codes are
    // no longer sent automatically while they still are.
    mocked.setItemAsync.mockRejectedValue(new Error('keystore unavailable'));
    await expect(saveOtpAutoSubmit(false)).rejects.toThrow('keystore unavailable');
  });

  it('never writes the preference anywhere but the secure store', async () => {
    wireSecureStore();
    await saveOtpAutoSubmit(true);
    expect(mocked.setItemAsync).toHaveBeenCalledTimes(1);
    expect(mocked.setItemAsync).toHaveBeenCalledWith(KEY, expect.any(String));
  });
});
