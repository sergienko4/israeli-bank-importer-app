import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { isAutoReadBuild } from '../lib/otpAutoReadPermission';
import { wakeAutoReadWindow } from '../lib/otpPushWake';
import { drainHeldMessages } from '../lib/otpStashRunner';
import { OTP_PUSH_TASK_NAME, registerOtpPushTask } from './otpPushTask';

jest.mock('expo-notifications', () => ({ registerTaskAsync: jest.fn() }));
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('../lib/otpAutoReadPermission', () => ({ isAutoReadBuild: jest.fn() }));
jest.mock('../lib/otpPushWake', () => ({ wakeAutoReadWindow: jest.fn() }));
jest.mock('../lib/otpStashRunner', () => ({ drainHeldMessages: jest.fn() }));

const mockRegister = jest.mocked(Notifications.registerTaskAsync);
const mockDefine = jest.mocked(TaskManager.defineTask);
const mockAutoReadBuild = jest.mocked(isAutoReadBuild);
const mockWake = jest.mocked(wakeAutoReadWindow);
const mockDrain = jest.mocked(drainHeldMessages);

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
});
