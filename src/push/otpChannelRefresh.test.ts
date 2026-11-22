import type { Session } from '../api/importerClient';
import { isChannelCacheDirty, refreshOtpChannel } from '../lib/otpChannelSync';
import { createChannelRefresh } from './otpChannelRefresh';

jest.mock('../lib/otpChannelSync', () => ({
  isChannelCacheDirty: jest.fn(),
  refreshOtpChannel: jest.fn(),
}));

const mockRefresh = jest.mocked(refreshOtpChannel);
const mockDirty = jest.mocked(isChannelCacheDirty);
const SESSION: Session = { baseUrl: 'https://host:8080', token: 'tok' };
const REFRESH_MS = 5 * 60_000;

/**
 * Flushes the refresh promise chain.
 * @returns Once the queued callbacks ran.
 */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('createChannelRefresh', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    mockRefresh.mockReset().mockResolvedValue({ status: 'ok', channel: 'app' });
    mockDirty.mockReset().mockReturnValue(false);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('refreshes at the bounded interval after success', async () => {
    const refresh = createChannelRefresh(
      () => SESSION,
      () => true,
    );

    refresh();
    await flush();
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    refresh();
    await flush();
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    jest.setSystemTime(REFRESH_MS);
    refresh();
    await flush();
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });

  it('backs off after a failed read', async () => {
    mockRefresh.mockResolvedValue({ status: 'failed', channel: null });
    const refresh = createChannelRefresh(
      () => SESSION,
      () => true,
    );

    refresh();
    await flush();
    refresh();
    await flush();
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    jest.setSystemTime(5_000);
    refresh();
    await flush();
    expect(mockRefresh).toHaveBeenCalledTimes(2);

    jest.setSystemTime(9_999);
    refresh();
    await flush();
    expect(mockRefresh).toHaveBeenCalledTimes(2);

    jest.setSystemTime(15_000);
    refresh();
    await flush();
    expect(mockRefresh).toHaveBeenCalledTimes(3);
  });

  it('drops a timed-out read and waits five seconds before retrying', async () => {
    let settle: (result: Awaited<ReturnType<typeof refreshOtpChannel>>) => void = () => undefined;
    mockRefresh.mockReturnValueOnce(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const refresh = createChannelRefresh(
      () => SESSION,
      () => true,
    );
    refresh();
    await flush();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    const firstOwner = mockRefresh.mock.calls[0]?.[1];
    expect(firstOwner?.()).toBe(true);

    await jest.advanceTimersByTimeAsync(20_000);
    await flush();
    expect(firstOwner?.()).toBe(false);

    refresh();
    await flush();
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    jest.setSystemTime(25_000);
    refresh();
    await flush();
    expect(mockRefresh).toHaveBeenCalledTimes(2);
    expect(firstOwner?.()).toBe(false);

    settle({ status: 'ok', channel: 'app' });
    await flush();
  });

  it('retries a dirty cache before the normal interval', async () => {
    const refresh = createChannelRefresh(
      () => SESSION,
      () => true,
    );
    refresh();
    await flush();
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    mockDirty.mockReturnValue(true);
    refresh();
    await flush();
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });

  it('does nothing without a session or after unmount', async () => {
    const inactive = createChannelRefresh(
      () => SESSION,
      () => false,
    );
    inactive();
    await flush();
    expect(mockRefresh).not.toHaveBeenCalled();

    const signedOut = createChannelRefresh(
      () => null,
      () => true,
    );
    signedOut();
    await flush();
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
