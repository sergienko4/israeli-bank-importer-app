import {
  isExpectationLive,
  MAX_EXPECTATION_MS,
  openExpectation,
  pickExpectation,
} from './otpExpectedWindow';

/**
 * The expectation window is the containment rule for SMS auto-read: with
 * `RECEIVE_SMS` granted the receiver is handed every message, and this is what
 * decides that almost all of them are never looked at.
 *
 * A message is only ever parsed while a bank request the user themselves
 * triggered is outstanding. Outside that window the receiver returns having
 * read nothing.
 */

const NOW = 1_700_000_000_000;

/**
 * Builds a pending request with a deadline relative to {@link NOW}.
 *
 * @param id - Request id.
 * @param deadlineOffsetMs - Milliseconds after `NOW` the request expires.
 * @returns A pending request shaped like the importer's contract.
 */
function request(id: string, deadlineOffsetMs: number) {
  return { id, bankId: 'onezero', createdAt: NOW, deadline: NOW + deadlineOffsetMs };
}

describe('openExpectation', () => {
  it('rides on the request deadline when that is sooner than the cap', () => {
    const expectation = openExpectation(request('a', 60_000), NOW);

    expect(expectation).toEqual({ requestId: 'a', expiresAt: NOW + 60_000 });
  });

  it('caps a far-future deadline so a bad value cannot hold the window open', () => {
    const expectation = openExpectation(request('a', 48 * 60 * 60 * 1000), NOW);

    expect(expectation.expiresAt).toBe(NOW + MAX_EXPECTATION_MS);
  });
});

describe('isExpectationLive', () => {
  it('is shut when nothing is expected', () => {
    expect(isExpectationLive(null, NOW)).toBe(false);
  });

  it('is open before the expiry', () => {
    expect(isExpectationLive({ requestId: 'a', expiresAt: NOW + 1 }, NOW)).toBe(true);
  });

  it('is shut at the expiry, not merely after it', () => {
    expect(isExpectationLive({ requestId: 'a', expiresAt: NOW }, NOW)).toBe(false);
  });

  it('is shut once the expiry has passed', () => {
    expect(isExpectationLive({ requestId: 'a', expiresAt: NOW - 1 }, NOW)).toBe(false);
  });
});

describe('pickExpectation', () => {
  it('returns nothing when no requests are pending', () => {
    expect(pickExpectation([], NOW)).toBeNull();
  });

  it('ignores requests whose deadline has already passed', () => {
    expect(pickExpectation([request('old', -1)], NOW)).toBeNull();
  });

  it('picks the request that expires first, since that is the urgent one', () => {
    const picked = pickExpectation([request('later', 120_000), request('sooner', 30_000)], NOW);

    expect(picked?.requestId).toBe('sooner');
  });
});
