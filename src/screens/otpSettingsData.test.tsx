/**
 * Proves the settings load survives a superseded read: one bounded retry,
 * importer changes stop it, and a cache failure never blocks the channel.
 */
import { act, renderHook } from '@testing-library/react-native';

import { type Session, setOtpSettings } from '../api/importerClient';
import { cacheOtpChannel, refreshOtpChannel } from '../lib/otpChannelSync';
import { useOtpChannel } from './otpSettingsData';
import { useChannelSave } from './otpSettingsSave';

jest.mock('../api/importerClient', () => ({ setOtpSettings: jest.fn() }));
jest.mock('../lib/otpChannelSync', () => ({
  refreshOtpChannel: jest.fn(),
  beginChannelChange: jest.fn(),
  endChannelChange: jest.fn(),
  cacheOtpChannel: jest.fn(),
  markChannelDirty: jest.fn(),
}));
jest.mock('../lib/haptics', () => ({ haptics: { success: jest.fn(), warning: jest.fn() } }));

const mockRefresh = jest.mocked(refreshOtpChannel);
const mockSet = jest.mocked(setOtpSettings);
const mockCache = jest.mocked(cacheOtpChannel);
const A: Session = { baseUrl: 'https://a.example', token: 't' };
const B: Session = { baseUrl: 'https://b.example', token: 't' };

/**
 * Builds a promise the test can settle later.
 * @returns The promise and its resolver.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/**
 * Flushes the hook's promise chain.
 * @returns Once React applied the result.
 */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useOtpChannel', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRefresh.mockReset();
    mockSet.mockReset();
    mockCache.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('retries one stale read and shows the channel', async () => {
    mockRefresh
      .mockResolvedValueOnce({ status: 'stale', channel: null })
      .mockResolvedValueOnce({ status: 'ok', channel: 'telegram' });
    const { result } = await renderHook(() => useOtpChannel(A));
    await flush();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(250);
    });
    await flush();

    expect(result.current.channel).toBe('telegram');
    expect(result.current.error).toBeNull();
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });

  it('reports a second stale read as retryable', async () => {
    mockRefresh.mockResolvedValue({ status: 'stale', channel: null });
    const { result } = await renderHook(() => useOtpChannel(A));
    await flush();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(250);
    });
    await flush();

    expect(result.current.channel).toBeNull();
    expect(result.current.error).toBe('The channel changed while loading. Try again.');
  });

  it('drops the retry when the importer changes during the delay', async () => {
    mockRefresh.mockImplementation(async (connection) =>
      connection.baseUrl === A.baseUrl
        ? { status: 'stale', channel: null }
        : { status: 'ok', channel: 'app' },
    );
    const { result, rerender } = await renderHook(
      ({ connection }: { connection: Session }) => useOtpChannel(connection),
      { initialProps: { connection: A } },
    );
    await flush();

    await rerender({ connection: B });
    await flush();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(250);
    });
    await flush();

    expect(result.current.channel).toBe('app');
  });

  it('keeps the cache update owned after the screen unmounts', async () => {
    let owner: (() => boolean) | undefined;
    const read = deferred<Awaited<ReturnType<typeof refreshOtpChannel>>>();
    mockRefresh.mockImplementation((_session, isCurrent) => {
      owner = isCurrent;
      return read.promise;
    });
    const { unmount } = await renderHook(() => useOtpChannel(A));
    await flush();
    expect(owner?.()).toBe(true);

    await unmount();
    expect(owner?.()).toBe(true);

    read.resolve({ status: 'ok', channel: 'app' });
    await flush();
  });

  it('retries with the renewed session for the same importer', async () => {
    const tokens: string[] = [];
    mockRefresh.mockImplementation(async (session) => {
      tokens.push(session.token);
      return tokens.length === 1
        ? { status: 'stale', channel: null }
        : { status: 'ok', channel: 'app' };
    });
    const { rerender } = await renderHook(
      ({ connection }: { connection: Session }) => useOtpChannel(connection),
      { initialProps: { connection: A } },
    );
    await flush();

    await rerender({ connection: { ...A, token: 'fresh' } });
    await flush();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(250);
    });
    await flush();

    expect(tokens).toEqual(['t', 'fresh']);
  });

  it('retries a failed load when the session renews', async () => {
    mockRefresh
      .mockResolvedValueOnce({ status: 'failed', channel: null, error: 'expired' })
      .mockResolvedValueOnce({ status: 'ok', channel: 'app' });
    const { result, rerender } = await renderHook(
      ({ connection }: { connection: Session }) => useOtpChannel(connection),
      { initialProps: { connection: A } },
    );
    await flush();
    expect(result.current.error).toBe('expired');

    await rerender({ connection: { ...A, token: 'fresh' } });
    await flush();

    expect(result.current.error).toBeNull();
    expect(result.current.channel).toBe('app');
  });

  it('follows the applied channel after a current save fails', async () => {
    mockRefresh.mockResolvedValueOnce({ status: 'ok', channel: 'telegram' });
    mockSet.mockRejectedValue(new Error('timed out'));
    const { result } = await renderHook(() => {
      const load = useOtpChannel(A);
      const save = useChannelSave({
        connection: A,
        channel: load.channel,
        setChannel: load.setChannel,
        reload: load.reload,
      });
      return { load, save };
    });
    await flush();
    expect(result.current.load.channel).toBe('telegram');

    mockRefresh.mockResolvedValueOnce({ status: 'ok', channel: 'app' });
    await act(async () => {
      await result.current.save.choose('app');
    });
    await flush();

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(result.current.load.channel).toBe('app');
    expect(result.current.save.saving).toBe(false);
  });

  it('keeps an optimistic choice through a delayed save after renewal', async () => {
    mockRefresh.mockResolvedValueOnce({ status: 'ok', channel: 'telegram' });
    const { result, rerender } = await renderHook(
      ({ connection }: { connection: Session }) => {
        const load = useOtpChannel(connection);
        const save = useChannelSave({
          connection,
          channel: load.channel,
          setChannel: load.setChannel,
          reload: load.reload,
        });
        return { load, save };
      },
      { initialProps: { connection: A } },
    );
    await flush();
    expect(result.current.load.channel).toBe('telegram');

    await rerender({ connection: { ...A, token: 'fresh' } });
    await flush();
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    const saving = deferred<Awaited<ReturnType<typeof setOtpSettings>>>();
    mockSet.mockReturnValue(saving.promise);
    await act(async () => {
      void result.current.save.choose('app');
      await Promise.resolve();
    });
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(250);
    });
    await flush();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(result.current.load.channel).toBe('app');

    saving.resolve({ ok: true });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.load.channel).toBe('app');
    expect(result.current.save.saving).toBe(false);
  });

  it('keeps a cache failure as a non-blocking warning', async () => {
    mockRefresh.mockResolvedValue({ status: 'cache-failed', channel: 'app' });
    const { result } = await renderHook(() => useOtpChannel(A));
    await flush();

    expect(result.current.channel).toBe('app');
    expect(result.current.error).toBeNull();
    expect(result.current.warning).not.toBeNull();
  });
});
