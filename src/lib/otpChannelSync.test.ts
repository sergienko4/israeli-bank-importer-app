/**
 * Proves the channel the receiver acts on comes from the importer, and that the
 * native flag is re-synced whether or not that read succeeded.
 */
import * as SecureStore from 'expo-secure-store';

import { getOtpSettings } from '../api/importerClient';
import { writeSwitch } from './otpCaptureSwitch';
import {
  beginChannelChange,
  cacheOtpChannel,
  confirmedOtpChannel,
  endChannelChange,
  isChannelCacheDirty,
  markChannelDirty,
  refreshOtpChannel,
} from './otpChannelSync';
import { applyStashGate } from './otpStashGate';

jest.mock('../api/importerClient', () => ({ getOtpSettings: jest.fn() }));
jest.mock('expo-secure-store', () => ({ setItemAsync: jest.fn(), getItemAsync: jest.fn() }));
jest.mock('./otpStashGate', () => ({ applyStashGate: jest.fn() }));

const mockGet = jest.mocked(getOtpSettings);
const mockSet = jest.mocked(SecureStore.setItemAsync);
const mockGetItem = jest.mocked(SecureStore.getItemAsync);
const mockGate = jest.mocked(applyStashGate);

const session = { baseUrl: 'https://importer.example', token: 't' };
const CHANNEL_KEY = 'otp.channel.v1';

/**
 * Lets the queued turns start.
 * @returns Once the current microtasks ran.
 */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * Occupies the real capture-switch queue until the test releases it.
 * @returns The release and the queue turn that ends after it.
 */
function holdQueue(): { release: () => void; blocker: Promise<void> } {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const blocker = writeSwitch(async () => {
    await held;
  });
  return { release, blocker };
}

beforeEach(() => {
  jest.resetAllMocks();
  mockGate.mockResolvedValue({ allowed: false, pushed: true });
  mockSet.mockResolvedValue(undefined);
  mockGetItem.mockResolvedValue(null);
});

describe('cacheOtpChannel', () => {
  it('records the channel so the receiver can read it with no session', async () => {
    await cacheOtpChannel('telegram', session.baseUrl);

    expect(mockSet).toHaveBeenCalledWith(CHANNEL_KEY, 'telegram');
    expect(isChannelCacheDirty()).toBe(false);
  });

  it('re-applies the capture gate so the receiver follows the new channel', async () => {
    await cacheOtpChannel('telegram', session.baseUrl);

    expect(mockGate).toHaveBeenCalledTimes(1);
  });

  it('keeps the dirty marker when a marker lands while the write waits', async () => {
    const { release, blocker } = holdQueue();
    const write = cacheOtpChannel('app', session.baseUrl);
    markChannelDirty();
    release();
    await blocker;

    await expect(write).resolves.toBe('stale');
    expect(isChannelCacheDirty()).toBe(true);

    await cacheOtpChannel('app', session.baseUrl);
    expect(isChannelCacheDirty()).toBe(false);
  });

  it('still re-applies the gate when the cache could not be written', async () => {
    mockSet.mockRejectedValue(new Error('keystore locked'));

    await expect(cacheOtpChannel('app', session.baseUrl)).resolves.toBe(false);
    expect(isChannelCacheDirty()).toBe(true);
    expect(mockGate).toHaveBeenCalledTimes(1);
  });
});

describe('refreshOtpChannel', () => {
  it('caches the channel the importer reports', async () => {
    mockGet.mockResolvedValue({ channel: 'telegram' });

    await expect(refreshOtpChannel(session)).resolves.toEqual({
      status: 'ok',
      channel: 'telegram',
    });
    expect(mockSet).toHaveBeenCalledWith(CHANNEL_KEY, 'telegram');
  });

  it('keeps the last known channel when the importer cannot be reached', async () => {
    mockGet.mockRejectedValue(new Error('offline'));

    await refreshOtpChannel(session);

    expect(mockSet).not.toHaveBeenCalled();
  });

  it('still re-applies the gate when the read failed', async () => {
    mockGet.mockRejectedValue(new Error('offline'));

    await refreshOtpChannel(session);

    expect(mockGate).toHaveBeenCalledTimes(1);
  });

  it('discards a read that a newer channel publication superseded', async () => {
    let resolveRead: (value: { channel: 'app' }) => void = () => undefined;
    mockGet.mockReturnValue(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );

    const read = refreshOtpChannel(session);
    await cacheOtpChannel('telegram', session.baseUrl);
    resolveRead({ channel: 'app' });

    await expect(read).resolves.toEqual({ status: 'stale', channel: 'telegram' });
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(CHANNEL_KEY, 'telegram');
  });

  it('discards a read whose importer is no longer active', async () => {
    mockGet.mockResolvedValue({ channel: 'app' });

    await expect(refreshOtpChannel(session, () => false)).resolves.toMatchObject({
      status: 'stale',
    });
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('reports a failed cache write so the watcher retries', async () => {
    mockGet.mockResolvedValue({ channel: 'app' });
    mockSet.mockRejectedValue(new Error('keystore locked'));

    await expect(refreshOtpChannel(session)).resolves.toEqual({
      status: 'cache-failed',
      channel: 'app',
    });
    expect(confirmedOtpChannel(session.baseUrl)).toBe('app');
    expect(confirmedOtpChannel('https://other.example')).toBeNull();
  });

  it('applies the gate once when the read succeeded', async () => {
    mockGet.mockResolvedValue({ channel: 'app' });

    await refreshOtpChannel(session);

    expect(mockGate).toHaveBeenCalledTimes(1);
  });
});

describe('channel save ownership', () => {
  it('keeps the save guard until every overlapping save ends', async () => {
    mockGet.mockResolvedValue({ channel: 'telegram' });
    beginChannelChange(session.baseUrl);
    beginChannelChange(session.baseUrl);

    endChannelChange(session.baseUrl);
    await expect(refreshOtpChannel(session)).resolves.toMatchObject({ status: 'stale' });
    expect(mockSet).not.toHaveBeenCalled();

    endChannelChange(session.baseUrl);
    await expect(refreshOtpChannel(session)).resolves.toMatchObject({ status: 'ok' });
  });

  it('does not invalidate a queued write when the caller is already stale', async () => {
    const { release, blocker } = holdQueue();
    const currentWrite = cacheOtpChannel('app', session.baseUrl);

    await expect(cacheOtpChannel('telegram', session.baseUrl, () => false)).resolves.toBe('stale');

    release();
    await blocker;
    await expect(currentWrite).resolves.toBe(true);
    expect(mockSet).toHaveBeenCalledWith(CHANNEL_KEY, 'app');
  });

  it('does not discard a newer write when an older write fails', async () => {
    let failOlder: (error: Error) => void = () => undefined;
    mockSet
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            failOlder = reject;
          }),
      )
      .mockResolvedValueOnce(undefined);
    const older = cacheOtpChannel('telegram', session.baseUrl);
    await flush();
    const newer = cacheOtpChannel('app', session.baseUrl);

    failOlder(new Error('keystore locked'));
    await expect(older).resolves.toBe(false);

    await expect(newer).resolves.toBe(true);
    expect(mockSet).toHaveBeenCalledWith(CHANNEL_KEY, 'app');
  });

  it('does not invalidate a user publication while its save guard is held', async () => {
    beginChannelChange(session.baseUrl);
    mockGet.mockResolvedValue({ channel: 'telegram' });
    const { release, blocker } = holdQueue();

    const saveWrite = cacheOtpChannel('app', session.baseUrl);
    await expect(refreshOtpChannel(session)).resolves.toMatchObject({ status: 'stale' });

    release();
    await blocker;
    await expect(saveWrite).resolves.toBe(true);
    endChannelChange(session.baseUrl);
  });

  it('discards a queued write after an uncertain save failure', async () => {
    mockGet.mockResolvedValue({ channel: 'telegram' });
    const { release, blocker } = holdQueue();
    const write = cacheOtpChannel('telegram', session.baseUrl);
    // The save's answer was lost: the retry marker moves the generation.
    markChannelDirty();
    release();
    await blocker;

    await expect(write).resolves.toBe('stale');
  });

  it('rejects a write whose owner was checked before the queue', async () => {
    let owned = true;
    const { release, blocker } = holdQueue();
    const write = cacheOtpChannel('app', session.baseUrl, () => owned);
    owned = false;
    release();
    await blocker;

    await expect(write).resolves.toBe('stale');
    expect(mockSet).not.toHaveBeenCalled();
  });
});
