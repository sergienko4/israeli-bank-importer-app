import type { PendingOtpRequest } from '../api/otp';
import { OTP_DISMISS_SNOOZE_MS, pruneSnoozed, selectPendingOtp } from './otpQueue';

function req(id: string, deadline: number): PendingOtpRequest {
  return { id, bankId: 'leumi', createdAt: 0, deadline };
}

describe('selectPendingOtp', () => {
  const now = 1_000;

  it('returns the first live, unsnoozed request', () => {
    const requests = [req('a', 5_000), req('b', 5_000)];
    expect(selectPendingOtp(requests, new Map(), now)?.id).toBe('a');
  });

  it('skips a snoozed request', () => {
    const requests = [req('a', 5_000), req('b', 5_000)];
    expect(selectPendingOtp(requests, new Map([['a', now + 1]]), now)?.id).toBe('b');
  });

  it('shows a snoozed request again once the snooze elapses', () => {
    const requests = [req('a', 120_000)];
    const snoozed = new Map([['a', now + OTP_DISMISS_SNOOZE_MS]]);

    expect(selectPendingOtp(requests, snoozed, now + OTP_DISMISS_SNOOZE_MS - 1)).toBeNull();
    expect(selectPendingOtp(requests, snoozed, now + OTP_DISMISS_SNOOZE_MS)?.id).toBe('a');
  });

  it('skips expired requests', () => {
    const requests = [req('a', 500), req('b', 5_000)];
    expect(selectPendingOtp(requests, new Map(), now)?.id).toBe('b');
  });

  it('keeps a request alive through its exact deadline', () => {
    expect(selectPendingOtp([req('a', now)], new Map(), now)?.id).toBe('a');
  });

  it('returns null when nothing is actionable', () => {
    expect(selectPendingOtp([], new Map(), now)).toBeNull();
    expect(selectPendingOtp([req('a', 500)], new Map(), now)).toBeNull();
    expect(selectPendingOtp([req('a', 5_000)], new Map([['a', now + 1]]), now)).toBeNull();
  });
});

describe('pruneSnoozed', () => {
  it('keeps ids that are still pending', () => {
    const snoozed = new Map([
      ['a', 5_000],
      ['b', 6_000],
    ]);

    expect(pruneSnoozed(snoozed, [req('a', 9_000), req('b', 9_000)])).toEqual(snoozed);
  });

  it('drops ids the importer no longer reports', () => {
    const snoozed = new Map([
      ['a', 5_000],
      ['b', 6_000],
    ]);

    expect(pruneSnoozed(snoozed, [req('b', 9_000)])).toEqual(new Map([['b', 6_000]]));
  });

  it('returns an empty map when nothing is pending', () => {
    expect(pruneSnoozed(new Map([['a', 5_000]]), [])).toEqual(new Map());
  });
});
