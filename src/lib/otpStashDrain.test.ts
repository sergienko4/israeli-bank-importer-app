import { STASH_SPENT, STASH_TTL_MS, type StashedMessage } from './otpStash';
import type { StashDrainPorts } from './otpStashDrain';
import { drainStash } from './otpStashDrain';

/**
 * The drain: what happens when a code was already sitting in the stash by the
 * time the importer asked for one.
 *
 * This runs unattended, so the acknowledgement is the security control. A
 * submitted message must be consumed exactly once, a rejected one must be
 * recorded so it is never sent again, and a transient failure must leave the
 * message untouched so a later attempt can still use it.
 */

const NOW = 1_700_000_000_000;
const SESSION = { baseUrl: 'https://importer.local', token: 't' };
const LIVE = { id: 'req-1', bankId: 'onezero', createdAt: NOW, deadline: NOW + 60_000 };

/**
 * Builds a held message, live at {@link NOW} unless overridden.
 *
 * @param over - Fields to replace.
 * @returns The message.
 */
function held(over: Partial<StashedMessage> = {}): StashedMessage {
  return {
    id: 'msg-1',
    body: 'Your code is 481920',
    sender: '+972500000000',
    receivedAt: NOW - 1000,
    attempted: [],
    ...over,
  };
}

/**
 * Builds ports each test overrides, recording every call that matters.
 *
 * @param overrides - Ports to replace.
 * @returns The ports plus the recorded calls.
 */
function ports(overrides: Partial<StashDrainPorts> = {}) {
  const submitted: { id: string; code: string }[] = [];
  const consumed: string[] = [];
  const attempts: { id: string; requestId: string }[] = [];
  const base: StashDrainPorts = {
    list: () => Promise.resolve([held()]),
    consume: (id) => {
      consumed.push(id);
      return Promise.resolve();
    },
    markAttempt: (id, requestId) => {
      attempts.push({ id, requestId });
      return Promise.resolve();
    },
    loadSession: () => Promise.resolve(SESSION),
    getPending: () => Promise.resolve([LIVE]),
    submit: (_session, id, code) => {
      submitted.push({ id, code });
      return Promise.resolve({ ok: true });
    },
    now: () => NOW,
    ...overrides,
  };
  return { ports: base, submitted, consumed, attempts };
}

describe('drainStash', () => {
  it('submits a held code against the pending request and consumes it', async () => {
    const { ports: p, submitted, consumed, attempts } = ports();

    await expect(drainStash(p)).resolves.toBe('submitted');
    expect(submitted).toEqual([{ id: 'req-1', code: '481920' }]);
    expect(consumed).toEqual(['msg-1']);
    expect(attempts).toEqual([]);
  });

  it('records the attempt and keeps the message when the importer rejects it', async () => {
    const {
      ports: p,
      consumed,
      attempts,
    } = ports({
      submit: () => Promise.resolve({ ok: false, error: 'wrong code' }),
    });

    await expect(drainStash(p)).resolves.toBe('rejected');
    expect(attempts).toEqual([{ id: 'msg-1', requestId: 'req-1' }]);
    expect(consumed).toEqual([]);
  });

  // Without this the next drain picks the unmarked twin and sends the same
  // rejected code again, spending another of the bank's few attempts.
  it('records the attempt against every held copy of a rejected code', async () => {
    const { ports: p, attempts } = ports({
      list: () =>
        Promise.resolve([
          held({ id: 'msg-1', receivedAt: NOW - 2000 }),
          held({ id: 'msg-2', body: 'Code: 481920 (resent)' }),
        ]),
      submit: () => Promise.resolve({ ok: false, error: 'wrong code' }),
    });

    await expect(drainStash(p)).resolves.toBe('rejected');
    expect(attempts.map((attempt) => attempt.id).sort()).toEqual(['msg-1', 'msg-2']);
  });

  // A 502 from a reverse proxy means the importer never judged the code. Burning
  // the message on it would throw away a code that is still perfectly good.
  it.each([500, 502, 503, 504, 408, 429])(
    'keeps the message when the importer answers %i',
    async (status) => {
      const {
        ports: p,
        consumed,
        attempts,
      } = ports({
        submit: () => Promise.resolve({ ok: false, error: 'later', status }),
      });

      await expect(drainStash(p)).resolves.toBe('failed');
      expect(attempts).toEqual([]);
      expect(consumed).toEqual([]);
    },
  );

  it.each([400, 401, 403, 404, 409, 422])(
    'records the attempt when the importer answers %i',
    async (status) => {
      const { ports: p, attempts } = ports({
        submit: () => Promise.resolve({ ok: false, error: 'no', status }),
      });

      await expect(drainStash(p)).resolves.toBe('rejected');
      expect(attempts).toEqual([{ id: 'msg-1', requestId: 'req-1' }]);
    },
  );

  it('leaves the message completely untouched when submitting throws', async () => {
    const {
      ports: p,
      consumed,
      attempts,
    } = ports({
      submit: () => Promise.reject(new Error('offline')),
    });

    await expect(drainStash(p)).resolves.toBe('failed');
    expect(consumed).toEqual([]);
    expect(attempts).toEqual([]);
  });

  it('reaches nothing over the network when the stash is empty', async () => {
    let reached = false;
    const { ports: p } = ports({
      list: () => Promise.resolve([]),
      loadSession: () => {
        reached = true;
        return Promise.resolve(SESSION);
      },
    });

    await expect(drainStash(p)).resolves.toBe('empty');
    expect(reached).toBe(false);
  });

  it('treats a stash of aged-out messages as empty', async () => {
    const { ports: p, submitted } = ports({
      list: () => Promise.resolve([held({ receivedAt: NOW - STASH_TTL_MS })]),
    });

    await expect(drainStash(p)).resolves.toBe('empty');
    expect(submitted).toEqual([]);
  });

  it('stops when the device is not paired', async () => {
    const { ports: p, submitted } = ports({ loadSession: () => Promise.resolve(null) });

    await expect(drainStash(p)).resolves.toBe('no-session');
    expect(submitted).toEqual([]);
  });

  it('stops when the importer is not waiting for a code', async () => {
    const { ports: p, submitted } = ports({ getPending: () => Promise.resolve([]) });

    await expect(drainStash(p)).resolves.toBe('no-pending');
    expect(submitted).toEqual([]);
  });

  // Security: an unrelated service's code parses exactly as cleanly as a bank's,
  // so two live codes must cost the user a few seconds of typing, not a guess.
  it('submits nothing when two held messages carry different codes', async () => {
    const { ports: p, submitted } = ports({
      list: () => Promise.resolve([held(), held({ id: 'msg-2', body: 'Your code is 300111' })]),
    });

    await expect(drainStash(p)).resolves.toBe('ambiguous');
    expect(submitted).toEqual([]);
  });

  // Banks resend, so one code can sit in two messages. Acknowledging only the
  // copy that happened to be chosen leaves its twin live, carrying a code whose
  // answer is already spent.
  it('submits once and consumes every copy when the same code arrived twice', async () => {
    const {
      ports: p,
      submitted,
      consumed,
    } = ports({
      list: () =>
        Promise.resolve([
          held({ receivedAt: NOW - 2000 }),
          held({ id: 'msg-2', body: 'Code: 481920 (resent)' }),
        ]),
    });

    await expect(drainStash(p)).resolves.toBe('submitted');
    expect(submitted).toHaveLength(1);
    expect(consumed.sort()).toEqual(['msg-1', 'msg-2']);
  });

  it('holds messages that carry no code at all without submitting', async () => {
    const { ports: p, submitted } = ports({
      list: () => Promise.resolve([held({ body: 'Mum says call me back' })]),
    });

    await expect(drainStash(p)).resolves.toBe('ambiguous');
    expect(submitted).toEqual([]);
  });

  // Security: retrying a rejected code against the same request is how the
  // bank's few attempts get spent in a loop.
  it('never sends a message twice against the request that already rejected it', async () => {
    const { ports: p, submitted } = ports({
      list: () => Promise.resolve([held({ attempted: ['req-1'] })]),
    });

    await expect(drainStash(p)).resolves.toBe('ambiguous');
    expect(submitted).toEqual([]);
  });

  it('still offers a message rejected by a different request', async () => {
    const { ports: p, submitted } = ports({
      list: () => Promise.resolve([held({ attempted: ['req-0'] })]),
    });

    await expect(drainStash(p)).resolves.toBe('submitted');
    expect(submitted).toEqual([{ id: 'req-1', code: '481920' }]);
  });

  // The drop is what stops a spent code being offered again, so a drop that
  // fails has to leave behind a marker no later request can look past.
  it('never offers a code again once the importer has accepted it', async () => {
    const entries = [held()];
    const pending = [LIVE];
    const { ports: p, submitted } = ports({
      list: () => Promise.resolve(entries),
      getPending: () => Promise.resolve(pending),
      consume: () => Promise.reject(new Error('write failed')),
      markAttempt: (id, requestId) => {
        entries[0] = { ...held(), attempted: [...entries[0].attempted, requestId] };
        return Promise.resolve();
      },
    });

    await expect(drainStash(p)).resolves.toBe('submitted');

    // A second scrape asks, so the request-specific record would not save us.
    pending[0] = { ...LIVE, id: 'req-2' };
    await expect(drainStash(p)).resolves.toBe('ambiguous');
    expect(submitted).toEqual([{ id: 'req-1', code: '481920' }]);
  });

  it('marks a spent copy it could not drop', async () => {
    const { ports: p, attempts } = ports({
      consume: () => Promise.reject(new Error('write failed')),
    });

    await expect(drainStash(p)).resolves.toBe('submitted');
    expect(attempts).toEqual([{ id: 'msg-1', requestId: STASH_SPENT }]);
  });

  // One stubborn copy used to abandon every copy behind it, which is the
  // leftover twin this path exists to remove.
  it('acknowledges the copies behind one that refuses', async () => {
    const tried: string[] = [];
    const { ports: p, attempts } = ports({
      list: () => Promise.resolve([held({ id: 'msg-1' }), held({ id: 'msg-2' })]),
      consume: (id) => {
        tried.push(id);
        return id === 'msg-1' ? Promise.reject(new Error('write failed')) : Promise.resolve();
      },
    });

    await expect(drainStash(p)).resolves.toBe('submitted');
    expect(tried).toEqual(['msg-1', 'msg-2']);
    expect(attempts).toEqual([{ id: 'msg-1', requestId: STASH_SPENT }]);
  });

  // A rejected code is worthless, so failing to record it is a reason to drop
  // it rather than a reason to leave it where the next drain can find it.
  it('drops a rejected copy it could not record', async () => {
    const { ports: p, consumed } = ports({
      submit: () => Promise.resolve({ ok: false, error: 'wrong code' }),
      markAttempt: () => Promise.reject(new Error('write failed')),
    });

    await expect(drainStash(p)).resolves.toBe('rejected');
    expect(consumed).toEqual(['msg-1']);
  });

  it('reads the stash once and submits at most one code per run', async () => {
    let reads = 0;
    const { ports: p, submitted } = ports({
      list: () => {
        reads += 1;
        return Promise.resolve([held(), held({ id: 'msg-2' }), held({ id: 'msg-3' })]);
      },
    });

    await expect(drainStash(p)).resolves.toBe('submitted');
    expect(reads).toBe(1);
    expect(submitted).toHaveLength(1);
  });
});
