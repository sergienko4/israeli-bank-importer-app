/**
 * Proves the channel the receiver acts on comes from the importer, and that the
 * native flag is re-synced whether or not that read succeeded.
 */
import { getOtpSettings } from '../api/importerClient';
import { saveOtpChannel } from './otpChannelStore';
import {
  cacheOtpChannel,
  confirmedOtpChannel,
  isChannelCacheDirty,
  markChannelDirty,
  refreshOtpChannel,
} from './otpChannelSync';
import { applyStashGate } from './otpStashGate';

jest.mock('../api/importerClient', () => ({ getOtpSettings: jest.fn() }));
jest.mock('./otpChannelStore', () => ({ saveOtpChannel: jest.fn() }));
jest.mock('./otpStashGate', () => ({ applyStashGate: jest.fn() }));

const mockGet = jest.mocked(getOtpSettings);
const mockSave = jest.mocked(saveOtpChannel);
const mockGate = jest.mocked(applyStashGate);

const session = { baseUrl: 'https://importer.example', token: 't' };

beforeEach(() => {
  jest.resetAllMocks();
  mockGate.mockResolvedValue({ allowed: false, pushed: true });
  mockSave.mockResolvedValue(undefined);
});

describe('cacheOtpChannel', () => {
  it('records the channel so the receiver can read it with no session', async () => {
    await cacheOtpChannel('telegram', session.baseUrl);

    expect(mockSave).toHaveBeenCalledWith('telegram');
    expect(isChannelCacheDirty()).toBe(false);
  });

  it('re-applies the capture gate so the receiver follows the new channel', async () => {
    await cacheOtpChannel('telegram', session.baseUrl);

    expect(mockGate).toHaveBeenCalledTimes(1);
  });

  it('keeps a dirty marker set while the cache write was pending', async () => {
    let finishWrite: () => void = () => undefined;
    mockSave.mockReturnValue(
      new Promise<void>((resolve) => {
        finishWrite = resolve;
      }),
    );

    const write = cacheOtpChannel('app', session.baseUrl);
    markChannelDirty();
    finishWrite();
    await write;

    expect(isChannelCacheDirty()).toBe(true);

    mockSave.mockResolvedValue(undefined);
    await cacheOtpChannel('app', session.baseUrl);
    expect(isChannelCacheDirty()).toBe(false);
  });

  it('still re-applies the gate when the cache could not be written', async () => {
    mockSave.mockRejectedValue(new Error('keystore locked'));

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
    expect(mockSave).toHaveBeenCalledWith('telegram');
  });

  it('keeps the last known channel when the importer cannot be reached', async () => {
    mockGet.mockRejectedValue(new Error('offline'));

    await refreshOtpChannel(session);

    expect(mockSave).not.toHaveBeenCalled();
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
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledWith('telegram');
  });

  it('discards a read whose importer is no longer active', async () => {
    mockGet.mockResolvedValue({ channel: 'app' });

    await expect(refreshOtpChannel(session, () => false)).resolves.toMatchObject({
      status: 'stale',
    });
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('reports a failed cache write so the watcher retries', async () => {
    mockGet.mockResolvedValue({ channel: 'app' });
    mockSave.mockRejectedValue(new Error('keystore locked'));

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
