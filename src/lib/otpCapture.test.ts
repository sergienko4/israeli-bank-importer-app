/**
 * Tests for the SMS capture seam.
 *
 * The seam is where an attacker-controlled message meets the app, so these
 * tests pin the two properties that matter: an ambiguous message delivers
 * nothing, and the message body itself goes no further than the extractor.
 */
import { noopOtpCaptureSource, type OtpCaptureSource, startOtpCapture } from './otpCapture';

/**
 * A source under test control: it hands back the emit hook and records stops.
 * @returns The fake source plus the levers a test needs to drive it.
 */
function fakeSource(): {
  source: OtpCaptureSource;
  emit: (body: string) => void;
  stopped: () => number;
} {
  let listener: ((body: string) => void) | null = null;
  let stops = 0;
  return {
    source: {
      start: (onMessage) => {
        listener = onMessage;
        return () => {
          stops += 1;
        };
      },
    },
    emit: (body) => {
      listener?.(body);
    },
    stopped: () => stops,
  };
}

describe('startOtpCapture', () => {
  it('delivers the code from an unambiguous message', () => {
    const { source, emit } = fakeSource();
    const codes: string[] = [];
    startOtpCapture(source, (code) => codes.push(code));

    emit('Your verification code is 483920');

    expect(codes).toEqual(['483920']);
  });

  it('delivers nothing when the message has no unambiguous code', () => {
    const { source, emit } = fakeSource();
    const codes: string[] = [];
    startOtpCapture(source, (code) => codes.push(code));

    emit('Code 483920 expired, use 517204 instead');
    emit('Account 12345678901 was debited');
    emit('Your statement is ready');

    expect(codes).toEqual([]);
  });

  it('delivers at most one code, so a burst of messages cannot retry', () => {
    const { source, emit } = fakeSource();
    const codes: string[] = [];
    startOtpCapture(source, (code) => codes.push(code));

    emit('Code 483920');
    emit('Code 517204');
    emit('Code 908311');

    expect(codes).toEqual(['483920']);
  });

  it('keeps listening past a message it could not read', () => {
    const { source, emit } = fakeSource();
    const codes: string[] = [];
    startOtpCapture(source, (code) => codes.push(code));

    emit('Your statement is ready');
    emit('Code 483920');

    expect(codes).toEqual(['483920']);
  });

  it('returns the stop function so the caller can end the listen window', () => {
    const { source, stopped } = fakeSource();
    const stop = startOtpCapture(source, () => undefined);

    expect(stopped()).toBe(0);
    stop();
    expect(stopped()).toBe(1);
  });
});

describe('noopOtpCaptureSource', () => {
  it('never delivers a code and stops cleanly', () => {
    const codes: string[] = [];
    const stop = startOtpCapture(noopOtpCaptureSource, (code) => codes.push(code));

    expect(codes).toEqual([]);
    expect(() => {
      stop();
    }).not.toThrow();
  });
});
