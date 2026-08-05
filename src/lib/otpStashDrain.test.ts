import type { SaveResult } from '../api/manifest';
import { ACK_MARGIN_MS, MIN_SEND_MS, SUBMIT_DEADLINE_MS, TASK_BUDGET_MS } from './otpDeadline';
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
    stillOwned: () => true,
    remainingMs: () => TASK_BUDGET_MS,
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

  it('takes the code out of circulation when the send itself throws', async () => {
    // The request was already on its way when the connection went, so the
    // importer may have taken the code and forwarded it with only the answer
    // lost. Recording it against this request alone would leave it selectable
    // by the next one, spending an attempt on a code the bank may already have
    // seen; marking it spent takes it away from every request instead.
    const {
      ports: p,
      consumed,
      attempts,
    } = ports({
      submit: () => Promise.reject(new Error('offline')),
    });

    await expect(drainStash(p)).resolves.toBe('unknown');
    expect(consumed).toEqual(['msg-1']);
    expect(attempts).toEqual([]);
  });

  it('takes the code out of circulation when the send never answers', async () => {
    // Nothing underneath the send enforces a deadline, and an importer that
    // accepts the connection then says nothing must not leave the message on
    // offer for the next drain once the serial lock is released.
    jest.useFakeTimers();
    try {
      const sent: { id: string; code: string }[] = [];
      const { ports: p, consumed } = ports({
        submit: (_session, id, code) => {
          sent.push({ id, code });
          return new Promise<SaveResult>(() => undefined);
        },
      });
      const running = drainStash(p);

      await jest.advanceTimersByTimeAsync(SUBMIT_DEADLINE_MS);

      await expect(running).resolves.toBe('unknown');
      expect(sent).toEqual([{ id: 'req-1', code: '481920' }]);
      expect(consumed).toEqual(['msg-1']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('sends nothing once a newer run has taken over', async () => {
    // This run read the held messages before the run that replaced it existed,
    // so its list is stale: the code it is about to offer may be one the newer
    // run has already sent and consumed.
    const { ports: p, submitted, consumed, attempts } = ports({ stillOwned: () => false });

    await expect(drainStash(p)).resolves.toBe('superseded');
    expect(submitted).toEqual([]);
    expect(consumed).toEqual([]);
    expect(attempts).toEqual([]);
  });

  it('sends nothing when too little is left to record what the send did', async () => {
    // The reads before the send have no deadline of their own, so a slow one
    // can eat most of the run. Sending anyway would leave the lock to release
    // with the message still on offer, and the next drain would send the same
    // code — the very thing the acknowledgement exists to prevent.
    const { ports: p, submitted, consumed } = ports({ remainingMs: () => ACK_MARGIN_MS });

    await expect(drainStash(p)).resolves.toBe('superseded');
    expect(submitted).toEqual([]);
    expect(consumed).toEqual([]);
  });

  it('sends nothing when what is left is too little to be worth a send', async () => {
    // Reaching the send with a sliver left means the reads ate the lease, so
    // the link is slow and a send squeezed into what remains is near-certain to
    // be abandoned. Abandoning it spends the message for nothing; refusing
    // leaves it for the next run, which starts with a whole lease.
    const {
      ports: p,
      submitted,
      consumed,
    } = ports({
      remainingMs: () => ACK_MARGIN_MS + MIN_SEND_MS - 1,
    });

    await expect(drainStash(p)).resolves.toBe('superseded');
    expect(submitted).toEqual([]);
    expect(consumed).toEqual([]);
  });

  it('gives a send only what is left of the run when that is the shorter', async () => {
    jest.useFakeTimers();
    try {
      const room = MIN_SEND_MS + 1_000;
      const { ports: p, consumed } = ports({
        remainingMs: () => ACK_MARGIN_MS + room,
        submit: () => new Promise<SaveResult>(() => undefined),
      });
      const running = drainStash(p);

      await jest.advanceTimersByTimeAsync(room);

      await expect(running).resolves.toBe('unknown');
      expect(consumed).toEqual(['msg-1']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('leaves the message completely untouched when a read throws', async () => {
    // Nothing was given to the importer, so the code is unspent and the message
    // is still worth keeping for whenever the network comes back.
    const {
      ports: p,
      submitted,
      consumed,
      attempts,
    } = ports({
      getPending: () => Promise.reject(new Error('offline')),
    });

    await expect(drainStash(p)).resolves.toBe('failed');
    expect(submitted).toEqual([]);
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

  // A copy marked spent because its delete failed is deliberately still offered
  // to `stashedCopiesOf`, so a later accepted drain retries the delete and the
  // raw message body finally leaves the device. Filtering it here would strand
  // that body in storage for the rest of the hold with no path left to remove it.
  it('retries the delete on a copy it could only mark spent', async () => {
    const entries = [held({ id: 'msg-1', attempted: [STASH_SPENT] }), held({ id: 'msg-2' })];
    const { ports: p, consumed } = ports({ list: () => Promise.resolve(entries) });

    await expect(drainStash(p)).resolves.toBe('submitted');
    expect(consumed).toEqual(['msg-1', 'msg-2']);
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
