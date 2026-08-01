/**
 * Holds the app's failure wording to a standard the code cannot enforce on its
 * own.
 *
 * The rules come from Nielsen Norman's error-message guidelines: say what
 * happened, say what to do about it, and never phrase it as the reader's fault.
 * A status code in a sentence fails all three at once, so the tests below treat
 * one as a defect rather than a detail.
 */
import {
  ALL_FAILURE_MESSAGES,
  causeOfStatus,
  failureMessage,
  messageForStatus,
} from './errorMessages';

describe('every failure message', () => {
  it('avoids words that read as an accusation', () => {
    for (const message of ALL_FAILURE_MESSAGES) {
      expect(message.text).not.toMatch(/invalid|illegal|incorrect|forbidden|bad request/i);
    }
  });

  it('never quotes a status code or a bare failure', () => {
    for (const message of ALL_FAILURE_MESSAGES) {
      expect(message.text).not.toMatch(/\(\d{3}\)|\berror\b|\bfailed\b|\bunexpected error\b/i);
    }
  });

  it('tells the reader what to do next', () => {
    for (const message of ALL_FAILURE_MESSAGES) {
      expect(message.text).toMatch(/try again|sign in again|wait a minute|check/i);
    }
  });

  it('reads as a finished sentence', () => {
    for (const message of ALL_FAILURE_MESSAGES) {
      expect(message.text).toMatch(/^[A-Z].*\.$/);
    }
  });
});

describe('causeOfStatus', () => {
  it.each([
    [401, 'signed-out'],
    [403, 'signed-out'],
    [429, 'too-busy'],
    [503, 'unavailable'],
    [500, 'unavailable'],
    [502, 'unavailable'],
    [400, 'refused'],
    [404, 'refused'],
    [409, 'refused'],
  ])('reads %s as %s', (status, expected) => {
    expect(causeOfStatus(Number(status))).toBe(expected);
  });

  it('separates a session that ended from an importer that is down', () => {
    expect(causeOfStatus(401)).not.toBe(causeOfStatus(500));
  });
});

describe('retryability', () => {
  it('does not offer a retry when the session has ended, because retrying cannot help', () => {
    expect(failureMessage('signed-out').isRetryable).toBe(false);
  });

  it.each(['refused', 'unavailable', 'too-busy', 'unreachable', 'timed-out', 'unexpected-reply'])(
    'offers a retry for %s',
    (cause) => {
      expect(failureMessage(cause as 'refused').isRetryable).toBe(true);
    },
  );
});

describe('messageForStatus', () => {
  it('tells a signed-out reader to sign in rather than to retry', () => {
    expect(messageForStatus(401)).toMatch(/sign in again/i);
  });

  it('keeps the status out of what the reader sees', () => {
    expect(messageForStatus(500)).not.toContain('500');
  });
});
