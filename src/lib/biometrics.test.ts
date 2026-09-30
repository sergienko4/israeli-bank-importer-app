import * as LocalAuthentication from 'expo-local-authentication';
import { AppState } from 'react-native';

import { authenticateBiometric } from './biometrics';

jest.mock('expo-local-authentication');

const mocked = LocalAuthentication as jest.Mocked<typeof LocalAuthentication>;
// The test environment's AppState is a plain mock object, so the state is set
// directly rather than driven through lifecycle events it does not emit.
const appState = AppState as unknown as { currentState: string };

describe('authenticateBiometric', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    appState.currentState = 'active';
  });

  it.each(['background', 'inactive', 'unknown'])(
    'fails without prompting while the app is %s',
    async (state) => {
      // A prompt raised off screen never answers, so asking would hang the caller.
      appState.currentState = state;
      mocked.hasHardwareAsync.mockResolvedValue(true);
      mocked.isEnrolledAsync.mockResolvedValue(true);

      await expect(authenticateBiometric('Unlock')).resolves.toEqual({ status: 'failed' });
      expect(mocked.authenticateAsync).not.toHaveBeenCalled();
    },
  );

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
