/**
 * Proves the cached OTP channel is safe by default and safe when broken.
 *
 * This cache is what lets the SMS receiver know the importer still collects
 * codes in this app. A device that cannot answer that question has no business
 * keeping bank messages, so every failure has to read as "not the app channel".
 */
import * as SecureStore from 'expo-secure-store';

import { writeSwitch } from './otpCaptureSwitch';
import { loadOtpChannelIsApp, saveOtpChannel, StaleChannelOwnerError } from './otpChannelStore';

jest.mock('expo-secure-store');

const mocked = SecureStore as jest.Mocked<typeof SecureStore>;

const KEY = 'otp.channel.v1';

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

describe('loadOtpChannelIsApp', () => {
  it('is false before the importer has ever been asked', async () => {
    wireSecureStore();

    await expect(loadOtpChannelIsApp()).resolves.toBe(false);
  });

  it('is true once the importer reported the app channel', async () => {
    wireSecureStore();
    await saveOtpChannel('app');

    await expect(loadOtpChannelIsApp()).resolves.toBe(true);
  });

  it('is false once the user moves collection to Telegram', async () => {
    wireSecureStore();
    await saveOtpChannel('app');
    await saveOtpChannel('telegram');

    await expect(loadOtpChannelIsApp()).resolves.toBe(false);
  });

  it('treats a value it does not recognise as another channel', async () => {
    const store = wireSecureStore();
    store[KEY] = 'App';

    await expect(loadOtpChannelIsApp()).resolves.toBe(false);
  });

  it('reads as false when the keystore cannot be opened', async () => {
    mocked.getItemAsync.mockRejectedValue(new Error('keystore locked'));

    await expect(loadOtpChannelIsApp()).resolves.toBe(false);
  });
});

describe('saveOtpChannel', () => {
  it('surfaces a failed write instead of silently dropping it', async () => {
    mocked.setItemAsync.mockRejectedValue(new Error('keystore locked'));

    await expect(saveOtpChannel('app')).rejects.toThrow('keystore locked');
  });

  it('revalidates the owner after waiting in the capture-switch queue', async () => {
    const store = wireSecureStore();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = writeSwitch(async () => {
      await held;
    });

    let owned = true;
    const confirmed = jest.fn();
    const write = saveOtpChannel('app', () => owned, confirmed);
    owned = false;
    release();

    await blocker;
    await expect(write).rejects.toBeInstanceOf(StaleChannelOwnerError);
    expect(confirmed).not.toHaveBeenCalled();
    expect(mocked.setItemAsync).not.toHaveBeenCalled();
    expect(store).toEqual({});
  });

  it('rejects when the owner changed before the queued write', async () => {
    wireSecureStore();

    await expect(saveOtpChannel('app', () => false)).rejects.toBeInstanceOf(StaleChannelOwnerError);
    expect(mocked.setItemAsync).not.toHaveBeenCalled();
  });

  it('confirms the importer answer before writing it', async () => {
    wireSecureStore();
    const confirmed = jest.fn();

    await saveOtpChannel('app', () => true, confirmed);

    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(confirmed.mock.invocationCallOrder[0]).toBeLessThan(
      mocked.setItemAsync.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });
});
