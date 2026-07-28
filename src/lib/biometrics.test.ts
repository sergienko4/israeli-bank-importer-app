import * as LocalAuthentication from 'expo-local-authentication';

import { authenticateBiometric } from './biometrics';

jest.mock('expo-local-authentication');

const mocked = LocalAuthentication as jest.Mocked<typeof LocalAuthentication>;

describe('authenticateBiometric', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('returns unsupported without prompting when biometric hardware is absent', async () => {
    mocked.hasHardwareAsync.mockResolvedValue(false);

    await expect(authenticateBiometric('Unlock')).resolves.toEqual({ status: 'unsupported' });
    expect(mocked.authenticateAsync).not.toHaveBeenCalled();
  });

  it('returns success only for an explicit biometric success', async () => {
    mocked.hasHardwareAsync.mockResolvedValue(true);
    mocked.isEnrolledAsync.mockResolvedValue(true);
    mocked.authenticateAsync.mockResolvedValue({ success: true });

    await expect(authenticateBiometric('Unlock')).resolves.toEqual({ status: 'success' });
  });

  it('returns failed when the prompt rejects authentication', async () => {
    mocked.hasHardwareAsync.mockResolvedValue(true);
    mocked.isEnrolledAsync.mockResolvedValue(true);
    mocked.authenticateAsync.mockResolvedValue({ success: false, error: 'authentication_failed' });

    await expect(authenticateBiometric('Unlock')).resolves.toEqual({
      status: 'failed',
      error: 'authentication_failed',
    });
  });

  it('returns failed when availability checks throw', async () => {
    mocked.hasHardwareAsync.mockRejectedValue(new Error('native unavailable'));

    await expect(authenticateBiometric('Unlock')).resolves.toEqual({ status: 'failed' });
  });
});
