import { loadOtpAutoRead } from './otpAutoReadStore';
import { loadOtpAutoSubmit } from './otpAutoSubmitStore';
import { backgroundCaptureAllowed, loadBackgroundCaptureAllowed } from './otpBackgroundGate';

jest.mock('./otpAutoReadStore', () => ({ loadOtpAutoRead: jest.fn() }));
jest.mock('./otpAutoSubmitStore', () => ({ loadOtpAutoSubmit: jest.fn() }));

const mockAutoRead = jest.mocked(loadOtpAutoRead);
const mockAutoSubmit = jest.mocked(loadOtpAutoSubmit);

describe('backgroundCaptureAllowed', () => {
  it('allows capture only when the user enabled both switches', () => {
    expect(backgroundCaptureAllowed(true, true)).toBe(true);
  });

  it('refuses when the user turned auto-read off', () => {
    expect(backgroundCaptureAllowed(false, true)).toBe(false);
  });

  it('refuses when the user wants to confirm each code', () => {
    expect(backgroundCaptureAllowed(true, false)).toBe(false);
  });

  it('refuses when neither switch is on', () => {
    expect(backgroundCaptureAllowed(false, false)).toBe(false);
  });
});

describe('loadBackgroundCaptureAllowed', () => {
  beforeEach(() => {
    jest.resetAllMocks();
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
});
