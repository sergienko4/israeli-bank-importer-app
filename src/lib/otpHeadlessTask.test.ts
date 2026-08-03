/**
 * Covers the rules the headless capture runs under, where nobody is watching:
 * which stored connections it will act on, and which messages it ignores.
 */
import type { Connection } from '../auth/connectionStore';
import { loadBackgroundCaptureAllowed } from './otpBackgroundGate';
import { autoSubmitFromMessage } from './otpBackgroundSubmit';
import { backgroundSession, OTP_SMS_TASK_NAME, runOtpSmsTask } from './otpHeadlessTask';

jest.mock('./otpBackgroundGate', () => ({ loadBackgroundCaptureAllowed: jest.fn() }));
jest.mock('./otpBackgroundSubmit', () => ({ autoSubmitFromMessage: jest.fn() }));

const mockAllowed = jest.mocked(loadBackgroundCaptureAllowed);
const mockSubmit = jest.mocked(autoSubmitFromMessage);

const NOW = 1_700_000_000_000;

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    baseUrl: 'https://importer.local',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: NOW + 60_000,
    ...overrides,
  };
}

describe('backgroundSession', () => {
  it('has nothing to work with when the device was never paired', () => {
    expect(backgroundSession(null, NOW)).toBeNull();
  });

  it('uses a live connection', () => {
    expect(backgroundSession(connection(), NOW)).toEqual({
      baseUrl: 'https://importer.local',
      token: 'access-token',
    });
  });

  it('refuses an expired token rather than renewing it', () => {
    // Renewing needs a biometric prompt, which is exactly the interaction this
    // feature removes. An expired token means the user types the code instead.
    expect(backgroundSession(connection({ expiresAt: NOW - 1 }), NOW)).toBeNull();
  });

  it('refuses a token that expires on this very millisecond', () => {
    expect(backgroundSession(connection({ expiresAt: NOW }), NOW)).toBeNull();
  });

  it('still uses a token with only seconds left, unlike the foreground path', () => {
    // The foreground code renews anything inside a two-minute margin. A one-shot
    // background submit does not need that headroom, so the margin is not applied.
    expect(backgroundSession(connection({ expiresAt: NOW + 1000 }), NOW)).not.toBeNull();
  });
});

describe('runOtpSmsTask', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockAllowed.mockResolvedValue(true);
  });

  it('ignores a payload carrying no body', async () => {
    await expect(runOtpSmsTask({})).resolves.toBeUndefined();
  });

  it('ignores an empty body', async () => {
    await expect(runOtpSmsTask({ body: '' })).resolves.toBeUndefined();
  });

  it('submits when the user has enabled both switches', async () => {
    await runOtpSmsTask({ body: 'Your code is 123456' });
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });

  it('reads no message once the user has turned a switch off', async () => {
    // The open window is a deadline on disk that outlives the process, so one
    // opened before the user changed their mind must not still submit a code.
    mockAllowed.mockResolvedValue(false);
    await runOtpSmsTask({ body: 'Your code is 123456' });
    expect(mockSubmit).not.toHaveBeenCalled();
  });
});

describe('OTP_SMS_TASK_NAME', () => {
  it('matches the name the native service starts', () => {
    // Changing this without changing OtpSmsAutoReadService.kt strands the task.
    expect(OTP_SMS_TASK_NAME).toBe('OtpSmsAutoRead');
  });
});
