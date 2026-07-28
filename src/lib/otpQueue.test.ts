import type { PendingOtpRequest } from '../api/otp';
import { selectPendingOtp } from './otpQueue';

function req(id: string, deadline: number): PendingOtpRequest {
  return { id, bankId: 'leumi', createdAt: 0, deadline };
}

describe('selectPendingOtp', () => {
  const now = 1_000;

  it('returns the first live, non-dismissed request', () => {
    const requests = [req('a', 5_000), req('b', 5_000)];
    expect(selectPendingOtp(requests, new Set(), now)?.id).toBe('a');
  });

  it('skips dismissed requests', () => {
    const requests = [req('a', 5_000), req('b', 5_000)];
    expect(selectPendingOtp(requests, new Set(['a']), now)?.id).toBe('b');
  });

  it('skips expired requests', () => {
    const requests = [req('a', 500), req('b', 5_000)];
    expect(selectPendingOtp(requests, new Set(), now)?.id).toBe('b');
  });

  it('keeps a request alive through its exact deadline', () => {
    expect(selectPendingOtp([req('a', now)], new Set(), now)?.id).toBe('a');
  });

  it('keeps dismissed requests suppressed across later polls', () => {
    const dismissed = new Set(['a']);
    const firstPoll = [req('a', 5_000)];
    const nextPoll = [req('a', 6_000), req('b', 6_000)];

    expect(selectPendingOtp(firstPoll, dismissed, now)).toBeNull();
    expect(selectPendingOtp(nextPoll, dismissed, now)?.id).toBe('b');
  });

  it('returns null when nothing is actionable', () => {
    expect(selectPendingOtp([], new Set(), now)).toBeNull();
    expect(selectPendingOtp([req('a', 500)], new Set(), now)).toBeNull();
    expect(selectPendingOtp([req('a', 5_000)], new Set(['a']), now)).toBeNull();
  });
});
