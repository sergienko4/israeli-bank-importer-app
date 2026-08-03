/**
 * Covers the rules the headless capture runs under, where nobody is watching:
 * which messages it acts on, and which it ignores.
 */
import { loadBackgroundCaptureAllowed } from './otpBackgroundGate';
import { autoSubmitFromMessage } from './otpBackgroundSubmit';
import { OTP_SMS_TASK_NAME, runOtpSmsTask } from './otpHeadlessTask';
import { drainHeldMessages } from './otpStashRunner';

jest.mock('./otpBackgroundGate', () => ({ loadBackgroundCaptureAllowed: jest.fn() }));
jest.mock('./otpBackgroundSubmit', () => ({ autoSubmitFromMessage: jest.fn() }));
jest.mock('./otpStashRunner', () => ({ drainHeldMessages: jest.fn() }));

const mockAllowed = jest.mocked(loadBackgroundCaptureAllowed);
const mockSubmit = jest.mocked(autoSubmitFromMessage);
const mockDrain = jest.mocked(drainHeldMessages);

describe('runOtpSmsTask', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockAllowed.mockResolvedValue(true);
    mockDrain.mockResolvedValue('empty');
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

  it('drains messages held before this one', async () => {
    // This message may not be the one that answers the request. An earlier code
    // held before anything asked for it would otherwise wait for a poll, and
    // there is no poll when the app is not running.
    await runOtpSmsTask({ body: 'Your code is 123456' });
    expect(mockDrain).toHaveBeenCalledTimes(1);
  });

  it('leaves held messages alone once a switch is off', async () => {
    mockAllowed.mockResolvedValue(false);
    await runOtpSmsTask({ body: 'Your code is 123456' });
    expect(mockDrain).not.toHaveBeenCalled();
  });
});

describe('OTP_SMS_TASK_NAME', () => {
  it('matches the name the native service starts', () => {
    // Changing this without changing OtpSmsAutoReadService.kt strands the task.
    expect(OTP_SMS_TASK_NAME).toBe('OtpSmsAutoRead');
  });
});
