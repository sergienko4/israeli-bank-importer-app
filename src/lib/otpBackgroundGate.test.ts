import { submitOtpUnattended } from '../api/importerClient';
import { loadOtpAutoRead } from './otpAutoReadStore';
import { loadOtpAutoSubmit } from './otpAutoSubmitStore';
import {
  backgroundCaptureAllowed,
  loadBackgroundCaptureAllowed,
  submitWhileAllowed,
} from './otpBackgroundGate';
import { CaptureSwitchedOffError, writeSwitch } from './otpCaptureSwitch';
import { loadOtpChannelIsApp } from './otpChannelStore';

jest.mock('../api/importerClient', () => ({ submitOtpUnattended: jest.fn() }));
jest.mock('./otpAutoReadStore', () => ({ loadOtpAutoRead: jest.fn() }));
jest.mock('./otpAutoSubmitStore', () => ({ loadOtpAutoSubmit: jest.fn() }));
jest.mock('./otpChannelStore', () => ({ loadOtpChannelIsApp: jest.fn() }));

const mockSubmit = jest.mocked(submitOtpUnattended);
const SESSION = { baseUrl: 'https://importer.local', token: 't' };

const mockAutoRead = jest.mocked(loadOtpAutoRead);
const mockAutoSubmit = jest.mocked(loadOtpAutoSubmit);
const mockChannelIsApp = jest.mocked(loadOtpChannelIsApp);

describe('backgroundCaptureAllowed', () => {
  it('allows capture only when both switches are on and this app collects codes', () => {
    expect(backgroundCaptureAllowed(true, true, true)).toBe(true);
  });

  it('refuses when the user turned auto-read off', () => {
    expect(backgroundCaptureAllowed(false, true, true)).toBe(false);
  });

  it('refuses when the user wants to confirm each code', () => {
    expect(backgroundCaptureAllowed(true, false, true)).toBe(false);
  });

  it('refuses when neither switch is on', () => {
    expect(backgroundCaptureAllowed(false, false, true)).toBe(false);
  });

  it('refuses when the importer collects codes over Telegram', () => {
    expect(backgroundCaptureAllowed(true, true, false)).toBe(false);
  });
});

describe('loadBackgroundCaptureAllowed', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockChannelIsApp.mockResolvedValue(true);
  });

  it('allows capture when both stored preferences are on', async () => {
    mockAutoRead.mockResolvedValue(true);
    mockAutoSubmit.mockResolvedValue(true);
    await expect(loadBackgroundCaptureAllowed()).resolves.toBe(true);
  });

  it('refuses when the stored auto-read preference is off', async () => {
    mockAutoRead.mockResolvedValue(false);
    mockAutoSubmit.mockResolvedValue(true);
    await expect(loadBackgroundCaptureAllowed()).resolves.toBe(false);
  });

  it('refuses when the stored auto-submit preference is off', async () => {
    mockAutoRead.mockResolvedValue(true);
    mockAutoSubmit.mockResolvedValue(false);
    await expect(loadBackgroundCaptureAllowed()).resolves.toBe(false);
  });

  it('refuses on the Telegram channel even with both switches left on', async () => {
    mockAutoRead.mockResolvedValue(true);
    mockAutoSubmit.mockResolvedValue(true);
    mockChannelIsApp.mockResolvedValue(false);
    await expect(loadBackgroundCaptureAllowed()).resolves.toBe(false);
  });
});

describe('submitWhileAllowed', () => {
  beforeEach(() => {
    mockSubmit.mockReset();
    mockSubmit.mockResolvedValue({ ok: true });
  });

  /**
   * Sets every switch the gate reads.
   *
   * @param on - Whether each one reads as on.
   */
  function switches(on: boolean): void {
    mockAutoRead.mockResolvedValue(on);
    mockAutoSubmit.mockResolvedValue(on);
    mockChannelIsApp.mockResolvedValue(true);
  }

  it('sends the code while the user allows background capture', async () => {
    switches(true);
    await expect(submitWhileAllowed(SESSION, 'req-1', '481920')).resolves.toEqual({ ok: true });
    expect(mockSubmit).toHaveBeenCalledWith(SESSION, 'req-1', '481920');
  });

  it('sends nothing, and says why, once capture is switched off', async () => {
    switches(false);
    await expect(submitWhileAllowed(SESSION, 'req-1', '481920')).rejects.toBeInstanceOf(
      CaptureSwitchedOffError,
    );
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('decides on a switch-off that was being stored when the send came due', async () => {
    // The capture read the switches before it fetched the request it answers,
    // and the user may have said no in between.
    switches(true);
    let stored: () => void = () => undefined;
    const write = new Promise<void>((resolve) => {
      stored = resolve;
    });
    const storing = writeSwitch(async () => {
      await write;
      switches(false);
    });
    const sending = submitWhileAllowed(SESSION, 'req-1', '481920');
    stored();
    await storing;

    await expect(sending).rejects.toBeInstanceOf(CaptureSwitchedOffError);
    expect(mockSubmit).not.toHaveBeenCalled();
  });
});
