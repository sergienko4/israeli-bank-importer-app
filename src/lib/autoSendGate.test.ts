import { SubmissionCancelledError } from '../api/authedTypes';
import { changePairing, currentPairing } from '../auth/pairingGeneration';
import { autoSendGate } from './autoSendGate';
import { createAutoSubmitAttempt } from './autoSubmitAttempt';
import { loadOtpAutoSubmit } from './otpAutoSubmitStore';
import { writeSwitch } from './otpCaptureSwitch';

jest.mock('./otpAutoSubmitStore', () => ({ loadOtpAutoSubmit: jest.fn() }));

const mockLoad = jest.mocked(loadOtpAutoSubmit);

/**
 * Builds the gate state and a start spy.
 * @param resolved - Whether the start resolves or rejects.
 * @returns The gate inputs and spies.
 */
function setup(resolved = true): {
  attempt: ReturnType<typeof createAutoSubmitAttempt>;
  token: number;
  start: jest.Mock;
  response: Response;
  pairing: number;
} {
  const attempt = createAutoSubmitAttempt();
  const response = { ok: true, status: 200 } as Response;
  const start = jest.fn(() =>
    resolved ? Promise.resolve(response) : Promise.reject(new Error('transport failed')),
  );
  return { attempt, token: attempt.token, start, response, pairing: currentPairing() };
}

describe('autoSendGate', () => {
  beforeEach(() => {
    mockLoad.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts the POST after the opt-in and pairing still match', async () => {
    const { attempt, token, start, response, pairing } = setup();

    await expect(autoSendGate(attempt, token, pairing)(start)).resolves.toBe(response);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('refuses the POST after the user opts out', async () => {
    const { attempt, token, start, pairing } = setup();
    mockLoad.mockResolvedValue(false);

    await expect(autoSendGate(attempt, token, pairing)(start)).rejects.toBeInstanceOf(
      SubmissionCancelledError,
    );
    expect(start).not.toHaveBeenCalled();
  });

  it('refuses the POST after the pairing changes', async () => {
    const { attempt, token, start, pairing } = setup();
    changePairing();

    await expect(autoSendGate(attempt, token, pairing)(start)).rejects.toBeInstanceOf(
      SubmissionCancelledError,
    );
    expect(start).not.toHaveBeenCalled();
  });

  it('expires a queued start so a late preference read cannot POST', async () => {
    jest.useFakeTimers();
    const { attempt, token, start, pairing } = setup();
    let finishRead: (value: boolean) => void = () => undefined;
    mockLoad.mockReturnValue(
      new Promise<boolean>((resolve) => {
        finishRead = resolve;
      }),
    );

    const gate = autoSendGate(attempt, token, pairing)(start);
    const assertion = expect(gate).rejects.toBeInstanceOf(SubmissionCancelledError);
    await jest.advanceTimersByTimeAsync(20_000);
    await assertion;

    finishRead(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(start).not.toHaveBeenCalled();
  });

  it('lets a started POST own its transport failure', async () => {
    const { attempt, token, start, pairing } = setup(false);

    await expect(autoSendGate(attempt, token, pairing)(start)).rejects.toThrow('transport failed');
  });

  it('releases the capture queue when the preference read never settles', async () => {
    jest.useFakeTimers();
    const { attempt, token, start, pairing } = setup();
    mockLoad.mockReturnValue(new Promise<boolean>(() => undefined));

    const gate = autoSendGate(attempt, token, pairing)(start);
    const assertion = expect(gate).rejects.toBeInstanceOf(SubmissionCancelledError);
    await jest.advanceTimersByTimeAsync(20_000);
    await assertion;

    const next = jest.fn(() => Promise.resolve());
    await expect(writeSwitch(next)).resolves.toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });
});
