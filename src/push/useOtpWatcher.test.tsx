/**
 * Proves the OTP watcher attaches the pairing that owns its connection and
 * scopes dismissals to the request the prompt actually showed.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { getPendingOtp } from '../api/importerClient';
import { useAuth } from '../auth/AuthContext';
import { syncAutoReadWindow } from '../lib/otpAutoReadWindow';
import { withRequestTimeout } from '../lib/requestTimeout';
import { useOtpWatcher } from './useOtpWatcher';

jest.mock('../api/importerClient', () => ({ getPendingOtp: jest.fn() }));
jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn() }));

/** The poll listeners the watcher registered, oldest first. */
const mockPollListeners: (() => void)[] = [];

jest.mock('expo-notifications', () => ({
  addNotificationReceivedListener: jest.fn((listener: () => void) => {
    mockPollListeners.push(listener);
    return { remove: jest.fn() };
  }),
}));
jest.mock('../lib/otpAutoReadWindow', () => ({ syncAutoReadWindow: jest.fn() }));
jest.mock('../lib/otpStashRunner', () => ({ drainHeldMessages: jest.fn() }));
jest.mock('../lib/requestTimeout', () => ({
  withRequestTimeout: jest.fn((work: Promise<void>) => work),
}));
jest.mock('./otpChannelRefresh', () => ({
  createChannelRefresh: jest.fn(() => () => undefined),
}));

const mockGetPending = jest.mocked(getPendingOtp);
const mockAuth = jest.mocked(useAuth);
const mockSms = jest.mocked(syncAutoReadWindow);
const mockTimeout = jest.mocked(withRequestTimeout);
const SESSION = { baseUrl: 'https://host:8080', token: 'tok' };

/**
 * Builds one pending request.
 * @param id - Request id.
 * @returns The pending request.
 */
function request(id: string): {
  id: string;
  bankId: string;
  createdAt: number;
  deadline: number;
} {
  return { id, bankId: 'hapoalim', createdAt: Date.now(), deadline: Date.now() + 60_000 };
}

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
 * Runs the latest registered poll listener and lets it settle.
 * @returns Once React applied the result.
 */
async function pollAgain(): Promise<void> {
  await act(async () => {
    mockPollListeners.at(-1)?.();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useOtpWatcher pairing ownership', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    mockPollListeners.length = 0;
    mockAuth.mockReset().mockReturnValue({
      connection: SESSION,
      pairing: 777,
    } as ReturnType<typeof useAuth>);
    mockGetPending.mockReset().mockResolvedValue([request('r1')]);
    mockTimeout.mockReset().mockImplementation((work: Promise<unknown>) => work);
  });

  it('carries the connection pairing instead of the global generation', async () => {
    const { result, unmount } = await renderHook(() => useOtpWatcher());

    await waitFor(() => {
      expect(result.current.pending).not.toBeNull();
    });
    expect(result.current.pending).toMatchObject({ id: 'r1', pairing: 777 });

    await unmount();
  });

  it('suppresses the request the prompt showed, not the one pending now', async () => {
    const a = request('a');
    const b = request('b');
    mockGetPending.mockResolvedValue([a]);
    const { result } = await renderHook(() => useOtpWatcher());
    await waitFor(() => {
      expect(result.current.pending?.id).toBe('a');
    });

    await act(async () => {
      result.current.dismiss('a', a.deadline, 777);
    });
    await waitFor(() => {
      expect(result.current.pending).toBeNull();
    });

    mockGetPending.mockResolvedValue([a, b]);
    await pollAgain();
    await waitFor(() => {
      expect(result.current.pending?.id).toBe('b');
    });

    // A late dismissal of the old request must not clear the new one.
    await act(async () => {
      result.current.dismiss('a', a.deadline, 777);
    });
    expect(result.current.pending?.id).toBe('b');
  });

  it('does not let an old pairing dismiss or clear the new request', async () => {
    const { result, rerender } = await renderHook(() => useOtpWatcher());
    await waitFor(() => {
      expect(result.current.pending?.id).toBe('r1');
    });

    mockAuth.mockReturnValue({
      connection: SESSION,
      pairing: 888,
    } as ReturnType<typeof useAuth>);
    await rerender(undefined);
    await waitFor(() => {
      expect(result.current.pending).toMatchObject({ id: 'r1', pairing: 888 });
    });

    const deadline = request('r1').deadline;
    await act(async () => {
      result.current.dismiss('r1', deadline, 777);
      result.current.clearAnswered('r1', deadline, 777);
    });

    expect(result.current.pending).toMatchObject({ id: 'r1', pairing: 888 });
  });

  it('ignores triggers while a poll is in flight', async () => {
    const first = deferred<ReturnType<typeof request>[]>();
    mockGetPending.mockReset().mockReturnValueOnce(first.promise);

    await renderHook(() => useOtpWatcher());
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockGetPending).toHaveBeenCalledTimes(1);

    await act(async () => {
      mockPollListeners.at(-1)?.();
      mockPollListeners.at(-1)?.();
      await Promise.resolve();
    });
    expect(mockGetPending).toHaveBeenCalledTimes(1);

    first.resolve([request('a')]);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it('drops a timed-out snapshot before the next poll starts', async () => {
    let expire: (error: Error) => void = () => undefined;
    mockTimeout.mockImplementationOnce((work: Promise<unknown>) =>
      Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          expire = reject;
        }),
      ]),
    );
    const first = deferred<ReturnType<typeof request>[]>();
    mockGetPending.mockReset().mockReturnValueOnce(first.promise);
    mockGetPending.mockResolvedValue([request('b')]);

    const { result } = await renderHook(() => useOtpWatcher());
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      expire(new Error('timed out'));
      await Promise.resolve();
      await Promise.resolve();
    });
    const smsCalls = mockSms.mock.calls.length;

    first.resolve([request('a')]);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.pending).toBeNull();
    expect(mockSms).toHaveBeenCalledTimes(smsCalls);

    await act(async () => {
      mockPollListeners.at(-1)?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.pending?.id).toBe('b');
  });

  it('ignores a timed-out snapshot that lands after a newer poll starts', async () => {
    let expire: (error: Error) => void = () => undefined;
    mockTimeout.mockImplementationOnce((work: Promise<unknown>) =>
      Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          expire = reject;
        }),
      ]),
    );
    const first = deferred<ReturnType<typeof request>[]>();
    const second = deferred<ReturnType<typeof request>[]>();
    mockGetPending
      .mockReset()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result } = await renderHook(() => useOtpWatcher());
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      expire(new Error('timed out'));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      mockPollListeners.at(-1)?.();
      await Promise.resolve();
    });
    expect(mockGetPending).toHaveBeenCalledTimes(2);

    first.resolve([request('a')]);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.pending).toBeNull();

    second.resolve([request('b')]);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.pending?.id).toBe('b');
  });

  it('does not carry a dismissal into a new pairing', async () => {
    const { result, rerender } = await renderHook(() => useOtpWatcher());
    await waitFor(() => {
      expect(result.current.pending?.id).toBe('r1');
    });

    await act(async () => {
      result.current.dismiss('r1', request('r1').deadline, 777);
    });
    await waitFor(() => {
      expect(result.current.pending).toBeNull();
    });

    mockAuth.mockReturnValue({
      connection: SESSION,
      pairing: 888,
    } as ReturnType<typeof useAuth>);
    await rerender(undefined);

    await waitFor(() => {
      expect(result.current.pending).toMatchObject({ id: 'r1', pairing: 888 });
    });
  });
});
