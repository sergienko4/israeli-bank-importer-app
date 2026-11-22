import type { PendingOtpRequest } from '../api/otp';
import {
  keepThroughGap,
  OTP_DISMISS_SNOOZE_MS,
  pruneSnoozed,
  pruneUsed,
  selectNextOtp,
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

describe('snoozeUntil', () => {
  const now = 10_000;

  it('caps a long snooze at one minute', () => {
    expect(snoozeUntil(now + 120_000, now)).toBe(now + OTP_DISMISS_SNOOZE_MS);
  });

  it('leaves time to answer when the deadline is closer', () => {
    expect(snoozeUntil(now + 30_000, now)).toBe(now + 20_000);
  });

  it('uses at least a five-second window when the deadline is close', () => {
    expect(snoozeUntil(now + 15_000, now)).toBe(now + 5_000);
    expect(snoozeUntil(now + 11_000, now)).toBe(now + 5_000);
    expect(snoozeUntil(now + 8_000, now)).toBe(now + 5_000);
    expect(snoozeUntil(now + 5_000, now)).toBe(now + 5_000);
  });

  it('never returns before now', () => {
    expect(snoozeUntil(now - 1_000, now)).toBe(now);
  });
});

describe('pruneSnoozed', () => {
  const now = 10_000;

  it('drops a snooze once its end is reached', () => {
    const snoozed = new Map([
      ['a', now],
      ['b', now + 1],
    ]);

    expect(pruneSnoozed(snoozed, now)).toEqual(new Map([['b', now + 1]]));
  });

  it('keeps a dismissal through a transient empty poll', () => {
    const snoozed = new Map([['a', now + 30_000]]);

    expect(pruneSnoozed(snoozed, now)).toEqual(snoozed);
  });

  it('returns an empty map once every snooze has elapsed', () => {
    expect(pruneSnoozed(new Map([['a', now - 1]]), now)).toEqual(new Map());
  });
});

describe('selectNextOtp', () => {
  const now = 1_000;

  it('keeps the request already on screen while it is still listed', () => {
    expect(
      selectNextOtp({
        current: req('a', 5_000),
        requests: [req('b', 5_000), req('a', 5_000)],
        snoozedUntil: new Map(),
        now,
      })?.id,
    ).toBe('a');
  });

  it('moves on when the current request is snoozed', () => {
    expect(
      selectNextOtp({
        current: req('a', 5_000),
        requests: [req('a', 5_000), req('b', 5_000)],
        snoozedUntil: new Map([['a', now + 1]]),
        now,
      })?.id,
    ).toBe('b');
  });

  it('moves on when the current request disappeared', () => {
    expect(
      selectNextOtp({
        current: req('a', 5_000),
        requests: [req('b', 5_000)],
        snoozedUntil: new Map(),
        now,
      })?.id,
    ).toBe('b');
  });
});

describe('keepThroughGap', () => {
  const now = 10_000;

  it('keeps a live request through one missing snapshot', () => {
    expect(keepThroughGap({ current: req('a', 20_000), requests: [], misses: 0, now })).toBe(true);
  });

  it('drops it on the second consecutive miss', () => {
    expect(keepThroughGap({ current: req('a', 20_000), requests: [], misses: 1, now })).toBe(false);
  });

  it('drops an expired request immediately', () => {
    expect(keepThroughGap({ current: req('a', now), requests: [], misses: 0, now })).toBe(false);
  });

  it('keeps it even when another request is available', () => {
    expect(
      keepThroughGap({
        current: req('a', 20_000),
        requests: [req('b', 20_000)],
        misses: 0,
        now,
      }),
    ).toBe(true);
  });

  it('drops it as soon as the snapshot still lists it', () => {
    expect(
      keepThroughGap({
        current: req('a', 20_000),
        requests: [req('a', 20_000)],
        misses: 0,
        now,
      }),
    ).toBe(false);
  });
});

describe('pruneUsed', () => {
  const now = 10_000;

  it('keeps markers whose request is still live', () => {
    const used = new Map([
      ['a', 9_000],
      ['b', 11_000],
    ]);

    expect(pruneUsed(used, now)).toEqual(new Map([['b', 11_000]]));
  });

  it('drops a marker once its deadline has passed', () => {
    expect(pruneUsed(new Map([['a', now]]), now + 1)).toEqual(new Map());
  });

  it('returns an empty map when nothing is live', () => {
    expect(pruneUsed(new Map([['a', 500]]), now)).toEqual(new Map());
  });
});
