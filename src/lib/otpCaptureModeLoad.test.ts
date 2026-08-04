import { hasReceiveSms, isAutoReadBuild } from './otpAutoReadPermission';
import { loadOtpAutoRead } from './otpAutoReadStore';
import { loadOtpAutoSubmit } from './otpAutoSubmitStore';
import { loadOtpCaptureMode } from './otpCaptureMode';

/**
 * Composition of the gate stack. The pure resolver is covered next door; what
 * matters here is that the real sources are all consulted and that a source
 * which cannot answer lands on consent rather than on a silent auto-read.
 */

jest.mock('./otpAutoReadPermission', () => ({
  hasReceiveSms: jest.fn(),
  isAutoReadBuild: jest.fn(),
}));
jest.mock('./otpAutoReadStore', () => ({ loadOtpAutoRead: jest.fn() }));
jest.mock('./otpAutoSubmitStore', () => ({ loadOtpAutoSubmit: jest.fn() }));

const mockHasPermission = jest.mocked(hasReceiveSms);
const mockIsAutoReadBuild = jest.mocked(isAutoReadBuild);
const mockAutoRead = jest.mocked(loadOtpAutoRead);
const mockAutoSubmit = jest.mocked(loadOtpAutoSubmit);

/** Opens every gate, so each test can shut exactly the one it is about. */
function openEveryGate(): void {
  mockIsAutoReadBuild.mockReturnValue(true);
  mockAutoRead.mockResolvedValue(true);
  mockAutoSubmit.mockResolvedValue(true);
  mockHasPermission.mockResolvedValue(true);
}

describe('loadOtpCaptureMode', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    openEveryGate();
  });

  it('reads auto-read when the build, both switches and the grant agree', async () => {
    await expect(loadOtpCaptureMode(true)).resolves.toBe('autoread');
  });

  it('asks per message when the grant was revoked behind the app', async () => {
    mockHasPermission.mockResolvedValue(false);
    await expect(loadOtpCaptureMode(true)).resolves.toBe('consent');
  });

  it('asks per message when the user wants to confirm each code', async () => {
    mockAutoSubmit.mockResolvedValue(false);
    await expect(loadOtpCaptureMode(true)).resolves.toBe('consent');
  });

  it('asks per message when the build carries no receiver', async () => {
    mockIsAutoReadBuild.mockReturnValue(false);
    await expect(loadOtpCaptureMode(true)).resolves.toBe('consent');
  });

  it('leaves the user typing when this platform has no consent flow', async () => {
    mockIsAutoReadBuild.mockReturnValue(false);
    await expect(loadOtpCaptureMode(false)).resolves.toBe('manual');
  });

  it.each([
    ['the build carries no receiver', (): void => void mockIsAutoReadBuild.mockReturnValue(false)],
    ['auto-read is off', (): void => void mockAutoRead.mockResolvedValue(false)],
    ['auto-submit is off', (): void => void mockAutoSubmit.mockResolvedValue(false)],
    ['the grant is gone', (): void => void mockHasPermission.mockResolvedValue(false)],
  ])('never resolves to auto-read while %s', async (_why, shutOne) => {
    shutOne();
    await expect(loadOtpCaptureMode(true)).resolves.not.toBe('autoread');
  });
});
