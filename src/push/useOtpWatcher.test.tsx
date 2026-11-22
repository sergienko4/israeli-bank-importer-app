/**
 * Proves the OTP watcher attaches the pairing that owns its connection, not the
 * global generation sampled at render time.
 */
import { renderHook, waitFor } from '@testing-library/react-native';

import { getPendingOtp } from '../api/importerClient';
import { useAuth } from '../auth/AuthContext';
import { useOtpWatcher } from './useOtpWatcher';

jest.mock('../api/importerClient', () => ({ getPendingOtp: jest.fn() }));
jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('expo-notifications', () => ({
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('../lib/otpAutoReadWindow', () => ({ syncAutoReadWindow: jest.fn() }));
jest.mock('../lib/otpChannelSync', () => ({ refreshOtpChannel: jest.fn() }));
jest.mock('../lib/otpStashRunner', () => ({ drainHeldMessages: jest.fn() }));

const mockGetPending = jest.mocked(getPendingOtp);
const mockAuth = jest.mocked(useAuth);
const SESSION = { baseUrl: 'https://host:8080', token: 'tok' };
const REQUEST = {
  id: 'r1',
  bankId: 'hapoalim',
  createdAt: Date.now(),
  deadline: Date.now() + 60_000,
};

describe('useOtpWatcher pairing ownership', () => {
  beforeEach(() => {
    mockAuth.mockReset().mockReturnValue({
      connection: SESSION,
      pairing: 777,
    } as ReturnType<typeof useAuth>);
    mockGetPending.mockReset().mockResolvedValue([REQUEST]);
  });

  it('carries the connection pairing instead of the global generation', async () => {
    const { result, unmount } = await renderHook(() => useOtpWatcher());

    await waitFor(() => {
      expect(result.current.pending).not.toBeNull();
    });
    expect(result.current.pending).toMatchObject({ id: 'r1', pairing: 777 });

    await unmount();
  });
});
