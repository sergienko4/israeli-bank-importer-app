import { loadOtpAutoRead } from './otpAutoReadStore';
import { loadOtpAutoSubmit } from './otpAutoSubmitStore';
import { backgroundCaptureAllowed, loadBackgroundCaptureAllowed } from './otpBackgroundGate';
import { loadOtpChannelIsApp } from './otpChannelStore';

jest.mock('./otpAutoReadStore', () => ({ loadOtpAutoRead: jest.fn() }));
jest.mock('./otpAutoSubmitStore', () => ({ loadOtpAutoSubmit: jest.fn() }));
jest.mock('./otpChannelStore', () => ({ loadOtpChannelIsApp: jest.fn() }));

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
