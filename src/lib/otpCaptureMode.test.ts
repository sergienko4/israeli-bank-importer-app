import { resolveOtpCaptureMode } from './otpCaptureMode';

/**
 * Mode resolution is the gate stack for SMS auto-read. Four independent things
 * must all agree before the app reads messages without asking: the build
 * declared the permission, the user turned both switches on, and Android
 * granted it. Any one of them shut falls back to the per-message consent flow.
 */

const ALL_OPEN = {
  autoReadBuild: true,
  autoReadEnabled: true,
  autoSubmitEnabled: true,
  smsPermissionGranted: true,
  consentAvailable: true,
} as const;

describe('resolveOtpCaptureMode', () => {
  it('reaches autoread only when every gate is open', () => {
    expect(resolveOtpCaptureMode(ALL_OPEN)).toBe('autoread');
  });

  it.each([
    ['the build did not declare the permission', 'autoReadBuild'],
    ['the user has not turned it on', 'autoReadEnabled'],
    ['the user still wants to confirm each code', 'autoSubmitEnabled'],
    ['Android has not granted it', 'smsPermissionGranted'],
  ] as const)('falls back to consent when %s', (_why, gate) => {
    expect(resolveOtpCaptureMode({ ...ALL_OPEN, [gate]: false })).toBe('consent');
  });

  // Auto-read alone leaves the native window shut, because the receiver has no
  // screen to fill in when a message starts the process. Suppressing consent
  // here would leave that combination with no capture at all.
  it('keeps consent when auto-read is on but auto-submit is off', () => {
    expect(resolveOtpCaptureMode({ ...ALL_OPEN, autoSubmitEnabled: false })).toBe('consent');
  });

  it('falls back to manual when consent is unavailable too', () => {
    expect(
      resolveOtpCaptureMode({ ...ALL_OPEN, autoReadBuild: false, consentAvailable: false }),
    ).toBe('manual');
  });

  it('does not let a granted permission alone unlock autoread', () => {
    expect(
      resolveOtpCaptureMode({ ...ALL_OPEN, autoReadBuild: false, autoReadEnabled: false }),
    ).toBe('consent');
  });
});
