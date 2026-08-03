/**
 * Covers the rules the headless capture runs under, where nobody is watching:
 * which messages it acts on, and which it ignores.
 */
import { loadBackgroundCaptureAllowed } from './otpBackgroundGate';
import { autoSubmitFromMessage } from './otpBackgroundSubmit';
import { OTP_SMS_TASK_NAME, runOtpSmsTask } from './otpHeadlessTask';

jest.mock('./otpBackgroundGate', () => ({ loadBackgroundCaptureAllowed: jest.fn() }));
jest.mock('./otpBackgroundSubmit', () => ({ autoSubmitFromMessage: jest.fn() }));

const mockAllowed = jest.mocked(loadBackgroundCaptureAllowed);
const mockSubmit = jest.mocked(autoSubmitFromMessage);

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
