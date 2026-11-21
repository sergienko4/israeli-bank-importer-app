import type { PendingOtpRequest } from '../api/otp';
import {
  OTP_DISMISS_SNOOZE_MS,
  pruneSnoozed,
  pruneUsed,
  selectPendingOtp,
  snoozeUntil,
} from './otpQueue';

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

describe('pruneUsed', () => {
  it('keeps auto-submit markers that are still pending', () => {
    const used = new Set(['a', 'b']);

    expect(pruneUsed(used, [req('a', 9_000), req('b', 9_000)])).toEqual(used);
  });

  it('drops markers for requests the importer no longer reports', () => {
    expect(pruneUsed(new Set(['a', 'b']), [req('b', 9_000)])).toEqual(new Set(['b']));
  });

  it('returns an empty set when nothing is pending', () => {
    expect(pruneUsed(new Set(['a']), [])).toEqual(new Set());
  });
});

describe('snoozeUntil', () => {
  const now = 10_000;

  it('caps a long snooze at one minute', () => {
    expect(snoozeUntil(now + 120_000, now)).toBe(now + OTP_DISMISS_SNOOZE_MS);
  });

  it('leaves time to answer when the deadline is closer', () => {
    expect(snoozeUntil(now + 30_000, now)).toBe(now + 20_000);
  });

  it('does not hide a request that is already near its deadline', () => {
    expect(snoozeUntil(now + 5_000, now)).toBe(now);
  });

  it('never returns before now', () => {
    expect(snoozeUntil(now - 1_000, now)).toBe(now);
  });
});
