import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { withRefreshLock } from '../auth/refreshLock';
import { isAutoReadBuild } from '../lib/otpAutoReadPermission';
import { loadUnattendedSession } from '../lib/otpBackgroundSession';
import { RENEWAL_GRACE_MS, TASK_BUDGET_MS } from '../lib/otpDeadline';
import { wakeAutoReadWindow } from '../lib/otpPushWake';
import { drainHeldMessages } from '../lib/otpStashRunner';
import { OTP_PUSH_TASK_NAME, registerOtpPushTask } from './otpPushTask';

jest.mock('expo-notifications', () => ({ registerTaskAsync: jest.fn() }));
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('../lib/otpAutoReadPermission', () => ({ isAutoReadBuild: jest.fn() }));
jest.mock('../lib/otpBackgroundSession', () => ({ loadUnattendedSession: jest.fn() }));
jest.mock('../lib/otpPushWake', () => ({ wakeAutoReadWindow: jest.fn() }));
jest.mock('../lib/otpStashRunner', () => ({ drainHeldMessages: jest.fn() }));

const mockRegister = jest.mocked(Notifications.registerTaskAsync);
const mockDefine = jest.mocked(TaskManager.defineTask);
const mockAutoReadBuild = jest.mocked(isAutoReadBuild);
const mockWake = jest.mocked(wakeAutoReadWindow);
const mockDrain = jest.mocked(drainHeldMessages);
const mockLoadSession = jest.mocked(loadUnattendedSession);

/**
 * Runs the task body the way a delivery would.
 *
 * @returns Nothing; assertions read the mocks.
 */
async function runTask(): Promise<void> {
  registerOtpPushTask();
  const executor = mockDefine.mock.calls[0][1];
  await executor({
    data: { forged: true },
    error: null,
    executionInfo: { taskName: OTP_PUSH_TASK_NAME, eventId: 'evt-1' },
  });
}

/**
 * Holds the refresh lock the way a renewal whose reply is late does.
 *
 * @returns Settles the held renewal; safe to call more than once.
 */
async function lateRenewal(): Promise<() => void> {
  let settle: () => void = () => undefined;
  void withRefreshLock((hold) => {
    hold(
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
    );
    return Promise.resolve();
  });
  await Promise.resolve();
  await Promise.resolve();
  return () => {
    settle();
  };
}

describe('registerOtpPushTask', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockRegister.mockResolvedValue(null);
    mockAutoReadBuild.mockReturnValue(true);
    mockDrain.mockResolvedValue('empty');
    Platform.OS = 'android';
  });

  it('registers the task so a delivery can start the process', () => {
    registerOtpPushTask();

    expect(mockDefine).toHaveBeenCalledWith(OTP_PUSH_TASK_NAME, expect.any(Function));
    expect(mockRegister).toHaveBeenCalledWith(OTP_PUSH_TASK_NAME);
  });

  it('stays out of a build with no receiver to open a window for', () => {
    mockAutoReadBuild.mockReturnValue(false);

    registerOtpPushTask();

    expect(mockDefine).not.toHaveBeenCalled();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('stays out of platforms that have no auto-read window at all', () => {
    Platform.OS = 'ios';

    registerOtpPushTask();

    expect(mockDefine).not.toHaveBeenCalled();
  });

  it('swallows a registration failure, which costs zero-touch and nothing else', () => {
    mockRegister.mockRejectedValue(new Error('unavailable'));

    expect(() => {
      registerOtpPushTask();
    }).not.toThrow();
  });

  it('asks the importer what is pending when a delivery runs the task', async () => {
    mockWake.mockResolvedValue('window-open');

    await runTask();

    // The payload is never read: only the importer decides whether to open.
    expect(mockWake).toHaveBeenCalledTimes(1);
    expect(mockWake.mock.calls[0][0]).toEqual(
      expect.objectContaining({ loadSession: expect.any(Function) }),
    );
  });

  it('drains held messages once the window is open', async () => {
    // This wake may be the first moment anything can act on a code that
    // arrived before the importer asked for it.
    mockWake.mockResolvedValue('window-open');

    await runTask();

    expect(mockDrain).toHaveBeenCalledTimes(1);
  });

  it('leaves held messages alone when nothing is pending', async () => {
    mockWake.mockResolvedValue('nothing-pending');

    await runTask();

    expect(mockDrain).not.toHaveBeenCalled();
  });
  it('gives the session it loads what is left of its own budget', async () => {
    // A renewal started with no time left to keep it can outlive the task, and
    // a process stopped mid-rotation leaves storage naming a spent token.
    mockWake.mockImplementation(async (ports) => {
      await ports.loadSession();
      return 'window-open';
    });

    await runTask();

    expect(mockLoadSession).toHaveBeenCalledTimes(1);
    const [left] = mockLoadSession.mock.calls[0] as unknown as [() => number];
    expect(left()).toBeLessThanOrEqual(TASK_BUDGET_MS);
    expect(left()).toBeGreaterThan(0);
  });

  it('drains with what is left of the same budget', async () => {
    jest.useFakeTimers();
    try {
      mockWake.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        return 'window-open';
      });
      const running = runTask();
      await jest.advanceTimersByTimeAsync(10_000);
      await running;

      const [left] = mockDrain.mock.calls[0];
      expect(left()).toBeLessThanOrEqual(TASK_BUDGET_MS - 10_000);
      expect(left()).toBeGreaterThan(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns when its budget runs out rather than waiting for a hung importer', async () => {
    jest.useFakeTimers();
    try {
      mockWake.mockReturnValue(new Promise(() => undefined));
      const running = runTask();
      await jest.advanceTimersByTimeAsync(TASK_BUDGET_MS);
      await expect(running).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not return while a renewal is still being kept', async () => {
    // A cold-started runtime is torn down soon after the task returns, and a
    // late reply lost with it takes the only live refresh token.
    jest.useFakeTimers();
    let settle: () => void = () => undefined;
    try {
      mockWake.mockResolvedValue('nothing-pending');
      settle = await lateRenewal();
      const done = jest.fn();
      const running = runTask().then(done);
      await jest.advanceTimersByTimeAsync(TASK_BUDGET_MS);
      expect(done).not.toHaveBeenCalled();
      settle();
      await running;
      expect(done).toHaveBeenCalledTimes(1);
    } finally {
      settle();
      jest.useRealTimers();
    }
  });

  it('stops waiting for a renewal once its grace runs out', async () => {
    jest.useFakeTimers();
    let settle: () => void = () => undefined;
    try {
      mockWake.mockResolvedValue('nothing-pending');
      settle = await lateRenewal();
      const running = runTask();
      await jest.advanceTimersByTimeAsync(RENEWAL_GRACE_MS);
      await expect(running).resolves.toBeUndefined();
    } finally {
      settle();
      jest.useRealTimers();
    }
  });
});
