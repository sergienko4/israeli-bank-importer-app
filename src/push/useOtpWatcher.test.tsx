/**
 * Proves the OTP watcher attaches the pairing that owns its connection and
 * scopes dismissals to the request the prompt actually showed.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { getPendingOtp } from '../api/importerClient';
import { useAuth } from '../auth/AuthContext';
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
jest.mock('../lib/otpChannelSync', () => ({ refreshOtpChannel: jest.fn() }));
jest.mock('../lib/otpStashRunner', () => ({ drainHeldMessages: jest.fn() }));

const mockGetPending = jest.mocked(getPendingOtp);
const mockAuth = jest.mocked(useAuth);
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
  beforeEach(() => {
    mockPollListeners.length = 0;
    mockAuth.mockReset().mockReturnValue({
      connection: SESSION,
      pairing: 777,
    } as ReturnType<typeof useAuth>);
    mockGetPending.mockReset().mockResolvedValue([request('r1')]);
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
    mockGetPending.mockResolvedValue([request('a')]);
    const { result } = await renderHook(() => useOtpWatcher());
    await waitFor(() => {
      expect(result.current.pending?.id).toBe('a');
    });

    mockGetPending.mockResolvedValue([request('b')]);
    await pollAgain();
    await waitFor(() => {
      expect(result.current.pending?.id).toBe('b');
    });

    await act(async () => {
      result.current.dismiss('a');
    });
    expect(result.current.pending?.id).toBe('b');

    mockGetPending.mockResolvedValue([request('a'), request('b')]);
    await pollAgain();
    await waitFor(() => {
      expect(result.current.pending?.id).toBe('b');
    });
  });

  it('does not carry a dismissal into a new pairing', async () => {
    const { result, rerender } = await renderHook(() => useOtpWatcher());
    await waitFor(() => {
      expect(result.current.pending?.id).toBe('r1');
    });

    await act(async () => {
      result.current.dismiss('r1');
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
