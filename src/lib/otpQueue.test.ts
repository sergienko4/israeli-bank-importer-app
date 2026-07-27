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

  it('returns null when nothing is actionable', () => {
    expect(selectPendingOtp([], new Set(), now)).toBeNull();
    expect(selectPendingOtp([req('a', 500)], new Set(), now)).toBeNull();
    expect(selectPendingOtp([req('a', 5_000)], new Set(['a']), now)).toBeNull();
  });
});
