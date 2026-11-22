/**
 * Proves a manual OTP send is refused once the importer pairing changes.
 *
 * The prompt holds the session it rendered with, so a Disconnect or a new
 * sign-in can replace the pairing while the code waits behind an earlier send,
 * a token renewal, or a 401 retry.
 */
import { act, renderHook } from '@testing-library/react-native';

import { submitOtp } from '../api/importerClient';
import { useAuth } from '../auth/AuthContext';
import { changePairing, currentPairing } from '../auth/pairingGeneration';
import { useOtpSubmission } from './useOtpSubmission';

jest.mock('../api/importerClient', () => ({ submitOtp: jest.fn() }));
jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn() }));

const mockSubmit = jest.mocked(submitOtp);
const mockAuth = jest.mocked(useAuth);
const SESSION = { baseUrl: 'https://host:8080', token: 'tok' };

beforeEach(() => {
  mockAuth.mockReset().mockReturnValue({ connection: SESSION } as ReturnType<typeof useAuth>);
  mockSubmit.mockReset();
});

describe('useOtpSubmission', () => {
  it('sends while the pairing the request arrived under is current', async () => {
    const onSubmitted = jest.fn();
    const start = jest.fn(() => Promise.resolve({} as Response));
    mockSubmit.mockImplementation(async ({ beforeSend }) => {
      await beforeSend?.(start);
      return { ok: true };
    });
    const pairing = currentPairing();
    const { result } = await renderHook(() => useOtpSubmission('r1', pairing, onSubmitted));

    await act(async () => {
      await expect(result.current.submit('123456')).resolves.toBe('sent');
    });

    expect(start).toHaveBeenCalledTimes(1);
    expect(onSubmitted).toHaveBeenCalledWith('r1');
  });

  it('refuses a manual send once the pairing changed', async () => {
    const onSubmitted = jest.fn();
    const start = jest.fn(() => Promise.resolve({} as Response));
    mockSubmit.mockImplementation(async ({ beforeSend }) => {
      try {
        await beforeSend?.(start);
      } catch {
        return null;
      }
      return { ok: true };
    });
    const pairing = currentPairing();
    const { result } = await renderHook(() => useOtpSubmission('r1', pairing, onSubmitted));

    changePairing();

    await act(async () => {
      await expect(result.current.submit('123456')).resolves.toBe('cancelled');
    });

    expect(start).not.toHaveBeenCalled();
    expect(onSubmitted).not.toHaveBeenCalled();
  });
});
