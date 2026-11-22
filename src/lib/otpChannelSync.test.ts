/**
 * Proves the channel the receiver acts on comes from the importer, and that the
 * native flag is re-synced whether or not that read succeeded.
 */
import { getOtpSettings } from '../api/importerClient';
import { saveOtpChannel, StaleChannelOwnerError } from './otpChannelStore';
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
jest.mock('./otpChannelStore', () => ({
  saveOtpChannel: jest.fn(),
  StaleChannelOwnerError: class StaleChannelOwnerError extends Error {},
}));
jest.mock('./otpStashGate', () => ({ applyStashGate: jest.fn() }));

const mockGet = jest.mocked(getOtpSettings);
const mockSave = jest.mocked(saveOtpChannel);
const mockGate = jest.mocked(applyStashGate);

const session = { baseUrl: 'https://importer.example', token: 't' };

beforeEach(() => {
  jest.resetAllMocks();
  mockGate.mockResolvedValue({ allowed: false, pushed: true });
  mockSave.mockImplementation(
    async (_channel, isCurrent = () => true, onPublished = () => undefined) => {
      if (!isCurrent()) {
        throw new StaleChannelOwnerError();
      }
      onPublished();
    },
  );
});

describe('cacheOtpChannel', () => {
  it('records the channel so the receiver can read it with no session', async () => {
    await cacheOtpChannel('telegram', session.baseUrl);

    expect(mockSave).toHaveBeenCalledWith('telegram', expect.any(Function), expect.any(Function));
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

    mockSave.mockImplementation(
      async (_channel, _isCurrent = () => true, onPublished = () => undefined) => {
        onPublished();
      },
    );
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
    expect(mockSave).toHaveBeenCalledWith('telegram', expect.any(Function), expect.any(Function));
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
    expect(mockSave).toHaveBeenCalledWith('telegram', expect.any(Function), expect.any(Function));
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
    mockSave.mockImplementation(async (_channel, _isCurrent, onConfirmed = () => undefined) => {
      onConfirmed();
      throw new Error('keystore locked');
    });

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

    endChannelChange(session.baseUrl);
    await expect(refreshOtpChannel(session)).resolves.toMatchObject({ status: 'ok' });
  });

  it('does not invalidate a queued write when the caller is already stale', async () => {
    let releaseCurrent: () => void = () => undefined;
    mockSave.mockImplementationOnce(
      async (_channel, isCurrent = () => true, onPublished = () => undefined) => {
        await new Promise<void>((resolve) => {
          releaseCurrent = resolve;
        });
        if (!isCurrent()) {
          throw new StaleChannelOwnerError();
        }
        onPublished();
      },
    );
    const currentWrite = cacheOtpChannel('app', session.baseUrl);

    await expect(cacheOtpChannel('telegram', session.baseUrl, () => false)).resolves.toBe('stale');

    releaseCurrent();
    await expect(currentWrite).resolves.toBe(true);
  });

  it('does not discard a newer write when an older write fails', async () => {
    let failOlder: (error: Error) => void = () => undefined;
    let finishNewer: () => void = () => undefined;
    mockSave.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          failOlder = reject;
        }),
    );
    const older = cacheOtpChannel('telegram', session.baseUrl);
    mockSave.mockImplementationOnce(
      async (_channel, isCurrent = () => true, onPublished = () => undefined) => {
        await new Promise<void>((resolve) => {
          finishNewer = resolve;
        });
        if (!isCurrent()) {
          throw new StaleChannelOwnerError();
        }
        onPublished();
      },
    );
    const newer = cacheOtpChannel('app', session.baseUrl);

    failOlder(new Error('keystore locked'));
    await expect(older).resolves.toBe(false);

    finishNewer();
    await expect(newer).resolves.toBe(true);
  });

  it('does not invalidate a user publication while its save guard is held', async () => {
    beginChannelChange(session.baseUrl);
    mockGet.mockResolvedValue({ channel: 'telegram' });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockSave.mockImplementationOnce(
      async (_channel, isCurrent = () => true, onPublished = () => undefined) => {
        await held;
        if (!isCurrent()) {
          throw new StaleChannelOwnerError();
        }
        onPublished();
      },
    );

    const saveWrite = cacheOtpChannel('app', session.baseUrl);
    await expect(refreshOtpChannel(session)).resolves.toMatchObject({ status: 'stale' });

    release();
    await expect(saveWrite).resolves.toBe(true);
    endChannelChange(session.baseUrl);
  });

  it('discards a queued write after an uncertain save failure', async () => {
    mockGet.mockResolvedValue({ channel: 'telegram' });
    mockSave.mockImplementation(async (_channel, isCurrent = () => true) => {
      // The save's answer was lost: the retry marker moves the generation.
      markChannelDirty();
      if (!isCurrent()) {
        throw new StaleChannelOwnerError();
      }
    });

    await expect(refreshOtpChannel(session)).resolves.toMatchObject({ status: 'stale' });
  });
});
