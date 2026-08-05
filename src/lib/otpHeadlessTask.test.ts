/**
 * Covers the rules the headless capture runs under, where nobody is watching:
 * which messages it acts on, and which it ignores.
 */
import { loadBackgroundCaptureAllowed } from './otpBackgroundGate';
import { autoSubmitFromMessage } from './otpBackgroundSubmit';
import { TASK_BUDGET_MS } from './otpDeadline';
import { OTP_SMS_TASK_NAME, runOtpSmsTask } from './otpHeadlessTask';
import { RETRY_INTERVAL_MS, RETRY_WINDOW_MS } from './otpRetry';
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
    mockSubmit.mockResolvedValue('submitted');
    mockDrain.mockResolvedValue('empty');
  });

  it('looks for the request a held message answers when woken with no body', async () => {
    // The receiver wakes the app with no body when it held a message because
    // nothing was waiting for it. Ignoring that wake-up would leave the code on
    // disk until the user next opened the app, which is the whole point of it.
    await runOtpSmsTask({});
    expect(mockDrain).toHaveBeenCalledTimes(1);
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('treats an empty body the same as none at all', async () => {
    await runOtpSmsTask({ body: '' });
    expect(mockDrain).toHaveBeenCalledTimes(1);
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('reads nothing at all once the user has turned a switch off', async () => {
    mockAllowed.mockResolvedValue(false);
    await runOtpSmsTask({});
    expect(mockDrain).not.toHaveBeenCalled();
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

  it('keeps offering the body until the request it answers is up', async () => {
    // The bank sends the code because the scraper asked it to, so the message can
    // beat the request that answers it even with a capture window already open:
    // that window is a deadline on disk written at the last poll and closed only
    // by a later one, so it can be live long after the request that opened it was
    // answered. Nothing keeps a copy on this path, so submitting once and giving
    // up would lose the code outright.
    jest.useFakeTimers();
    try {
      mockSubmit.mockResolvedValueOnce('no-pending').mockResolvedValueOnce('submitted');
      const running = runOtpSmsTask({ body: 'Your code is 123456' });
      await jest.advanceTimersByTimeAsync(RETRY_INTERVAL_MS);
      await running;
      expect(mockSubmit).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('sends the code once and stops when the importer takes it', async () => {
    // Every extra offer risks spending one of the bank's few attempts.
    await runOtpSmsTask({ body: 'Your code is 123456' });
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not send again when the first send may already have landed', async () => {
    // A send that threw was already on its way, so the importer may have taken
    // the code. Offering it again is how a bank's handful of attempts get spent.
    mockSubmit.mockResolvedValue('unknown');
    await runOtpSmsTask({ body: 'Your code is 123456' });
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });

  it('drains messages held before this one', async () => {
    // This message may not be the one that answers the request. An earlier code
    // held before anything asked for it would otherwise wait for a poll, and
    // there is no poll when the app is not running.
    await runOtpSmsTask({ body: 'Your code is 123456' });
    expect(mockDrain).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when reading the switches fails', async () => {
    // An unreadable preference is not permission, and letting the failure out
    // would reject the whole task and skip the drain below it.
    mockAllowed.mockRejectedValue(new Error('keystore locked'));
    await expect(runOtpSmsTask({ body: 'Your code is 123456' })).resolves.toBeUndefined();
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockDrain).not.toHaveBeenCalled();
  });

  it('leaves held messages alone once a switch is off', async () => {
    mockAllowed.mockResolvedValue(false);
    await runOtpSmsTask({ body: 'Your code is 123456' });
    expect(mockDrain).not.toHaveBeenCalled();
  });

  it('gives the drain only what is left of its own budget', async () => {
    // The wake lock lasts as long as this task does, so a drain still writing
    // after it returns is writing on borrowed time. A code the importer may
    // have taken, left unrecorded because the process died mid-write, is a code
    // the next wake-up offers all over again.
    jest.useFakeTimers();
    try {
      mockSubmit.mockResolvedValue('no-pending');
      const running = runOtpSmsTask({ body: 'Your code is 123456' });
      await jest.advanceTimersByTimeAsync(RETRY_WINDOW_MS);
      await running;

      const left = mockDrain.mock.calls[0]?.[0];
      expect(left()).toBeLessThanOrEqual(TASK_BUDGET_MS - RETRY_WINDOW_MS);
      expect(left()).toBeGreaterThan(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns when its budget runs out rather than waiting for a hung importer', async () => {
    // The importer calls have no deadline of their own — React Native's HTTP
    // client has no read timeout — so a server that accepts the connection and
    // then says nothing would hold the device awake until Android killed the
    // task mid-request, and a killed task releases its wake lock the hard way.
    jest.useFakeTimers();
    try {
      mockDrain.mockReturnValue(new Promise(() => undefined));
      const running = runOtpSmsTask({});
      await jest.advanceTimersByTimeAsync(TASK_BUDGET_MS);
      await expect(running).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('OTP_SMS_TASK_NAME', () => {
  it('matches the name the native service starts', () => {
    // Changing this without changing OtpSmsAutoReadService.kt strands the task.
    expect(OTP_SMS_TASK_NAME).toBe('OtpSmsAutoRead');
  });
});
