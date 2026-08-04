import {
  liveStashEntries,
  selectStashedCode,
  STASH_SPENT,
  STASH_TTL_MS,
  type StashedMessage,
} from './otpStash';

const NOW = 1_785_265_164_486;

function entry(over: Partial<StashedMessage> = {}): StashedMessage {
  return {
    id: 'a1',
    body: 'Your code is 482913',
    sender: '+972500000000',
    receivedAt: NOW - 1000,
    attempted: [],
    ...over,
  };
}

describe('stash constants', () => {
  it('holds a message for ten minutes, matching the auto-read window cap', () => {
    expect(STASH_TTL_MS).toBe(10 * 60 * 1000);
  });
});

describe('liveStashEntries', () => {
  it('keeps an entry inside the window', () => {
    expect(liveStashEntries([entry({ receivedAt: NOW - STASH_TTL_MS + 1 })], NOW)).toHaveLength(1);
  });

  it('drops an entry exactly at the window edge', () => {
    expect(liveStashEntries([entry({ receivedAt: NOW - STASH_TTL_MS })], NOW)).toHaveLength(0);
  });

  it('drops an entry older than the window', () => {
    expect(liveStashEntries([entry({ receivedAt: NOW - STASH_TTL_MS - 1 })], NOW)).toHaveLength(0);
  });

  it('returns nothing for an empty stash', () => {
    expect(liveStashEntries([], NOW)).toEqual([]);
  });
});

describe('selectStashedCode', () => {
  // The one marker that outlives the request it was written for: a code the
  // importer has accepted is spent for every request, not only that one.
  it('skips a message marked spent, whichever request is asking', () => {
    expect(selectStashedCode([entry({ attempted: [STASH_SPENT] })], 'req-9', NOW)).toBeNull();
  });

  it('returns the code when exactly one message carries one', () => {
    const found = selectStashedCode([entry()], 'req-1', NOW);
    expect(found?.code).toBe('482913');
    expect(found?.entry.id).toBe('a1');
  });

  it('returns nothing when the stash is empty', () => {
    expect(selectStashedCode([], 'req-1', NOW)).toBeNull();
  });

  it('ignores a message that carries no unambiguous code', () => {
    expect(selectStashedCode([entry({ body: 'no digits here' })], 'req-1', NOW)).toBeNull();
  });

  it('ignores an expired message even though it carries a code', () => {
    const stale = entry({ receivedAt: NOW - STASH_TTL_MS - 1 });
    expect(selectStashedCode([stale], 'req-1', NOW)).toBeNull();
  });

  // The security rule. An unrelated service's one-time code parses exactly as
  // cleanly as a bank's, and submitting the wrong one spends an attempt the
  // user cannot get back, so two candidates means the user types it instead.
  it('submits nothing when two messages carry different codes', () => {
    const two = [
      entry({ id: 'a1', body: 'code 482913' }),
      entry({ id: 'a2', body: 'code 111222' }),
    ];
    expect(selectStashedCode(two, 'req-1', NOW)).toBeNull();
  });

  it('still submits when two messages carry the same code, as a resend does', () => {
    const twice = [
      entry({ id: 'a1', body: 'code 482913', receivedAt: NOW - 2000 }),
      entry({ id: 'a2', body: 'Your code is 482913', receivedAt: NOW - 1000 }),
    ];
    expect(selectStashedCode(twice, 'req-1', NOW)?.code).toBe('482913');
  });

  it('prefers the newest message when several carry the same code', () => {
    const twice = [
      entry({ id: 'old', receivedAt: NOW - 5000 }),
      entry({ id: 'new', receivedAt: NOW - 1000 }),
    ];
    expect(selectStashedCode(twice, 'req-1', NOW)?.entry.id).toBe('new');
  });

  it('prefers the newest message whichever order they are held in', () => {
    const twice = [
      entry({ id: 'new', receivedAt: NOW - 1000 }),
      entry({ id: 'old', receivedAt: NOW - 5000 }),
    ];
    expect(selectStashedCode(twice, 'req-1', NOW)?.entry.id).toBe('new');
  });

  // Without this a code the importer already rejected would be resubmitted on
  // every drain, spending the bank's few attempts on an answer known to be wrong.
  it('ignores a message already attempted against this request', () => {
    const tried = entry({ attempted: ['req-1'] });
    expect(selectStashedCode([tried], 'req-1', NOW)).toBeNull();
  });

  it('still offers a message attempted against a different request', () => {
    const tried = entry({ attempted: ['req-other'] });
    expect(selectStashedCode([tried], 'req-1', NOW)?.code).toBe('482913');
  });

  it('treats an exhausted candidate as absent rather than falling back', () => {
    const entries = [
      entry({ id: 'a1', body: 'code 482913', attempted: ['req-1'] }),
      entry({ id: 'a2', body: 'code 111222' }),
    ];
    expect(selectStashedCode(entries, 'req-1', NOW)?.code).toBe('111222');
  });
});
