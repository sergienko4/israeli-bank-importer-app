import type { BackgroundSubmitPorts } from './otpBackgroundSubmit';
import { autoSubmitFromMessage } from './otpBackgroundSubmit';

/**
 * The background submit path. This runs with no UI attached and possibly with
 * the app killed, so every stopping condition has to be explicit — there is no
 * user watching to notice it did the wrong thing.
 *
 * The ordering matters and is asserted here: extraction happens before any
 * network call, so an ordinary message costs nothing and reaches nothing.
 */

const NOW = 1_700_000_000_000;
const SESSION = { baseUrl: 'https://importer.local', token: 't' };

/** A pending request, live at {@link NOW}. */
const LIVE = { id: 'req-1', bankId: 'onezero', createdAt: NOW, deadline: NOW + 60_000 };

/**
 * Builds ports each test overrides as needed, recording what was submitted.
 *
 * @param overrides - Ports to replace.
 * @returns The ports plus the recorded submissions.
 */
function ports(overrides: Partial<BackgroundSubmitPorts> = {}) {
  const submitted: { id: string; code: string }[] = [];
  const base: BackgroundSubmitPorts = {
    loadSession: () => Promise.resolve(SESSION),
    getPending: () => Promise.resolve([LIVE]),
    submit: (_session, id, code) => {
      submitted.push({ id, code });
      return Promise.resolve({ ok: true });
    },
    now: () => NOW,
    ...overrides,
  };
  return { ports: base, submitted };
}

describe('autoSubmitFromMessage', () => {
  it('submits the code against the pending request', async () => {
    const { ports: p, submitted } = ports();

    await expect(autoSubmitFromMessage('Your code is 481920', p)).resolves.toBe('submitted');
    expect(submitted).toEqual([{ id: 'req-1', code: '481920' }]);
  });

  it('reaches nothing over the network for a message with no code', async () => {
    let reached = false;
    const { ports: p } = ports({
      loadSession: () => {
        reached = true;
        return Promise.resolve(SESSION);
      },
    });

    await expect(autoSubmitFromMessage('Mum says call me back', p)).resolves.toBe('no-code');
    expect(reached).toBe(false);
  });

  it('refuses a message carrying two different digit runs', async () => {
    const { ports: p, submitted } = ports();

    await expect(autoSubmitFromMessage('Card 4580 code 481920', p)).resolves.toBe('no-code');
    expect(submitted).toEqual([]);
  });

  it('does nothing when no request is pending', async () => {
    const { ports: p, submitted } = ports({ getPending: () => Promise.resolve([]) });

    await expect(autoSubmitFromMessage('Your code is 481920', p)).resolves.toBe('no-pending');
    expect(submitted).toEqual([]);
  });

  it('does nothing when every pending request has already expired', async () => {
    const { ports: p, submitted } = ports({
      getPending: () => Promise.resolve([{ ...LIVE, deadline: NOW - 1 }]),
    });

    await expect(autoSubmitFromMessage('Your code is 481920', p)).resolves.toBe('no-pending');
    expect(submitted).toEqual([]);
  });

  it('does nothing when the device is not connected to an importer', async () => {
    const { ports: p, submitted } = ports({ loadSession: () => Promise.resolve(null) });

    await expect(autoSubmitFromMessage('Your code is 481920', p)).resolves.toBe('no-session');
    expect(submitted).toEqual([]);
  });

  it('reports a rejected code rather than retrying it', async () => {
    const { ports: p } = ports({
      submit: () => Promise.resolve({ ok: false, error: 'wrong code' }),
    });

    await expect(autoSubmitFromMessage('Your code is 481920', p)).resolves.toBe('rejected');
  });

  it('survives an importer that is unreachable', async () => {
    const { ports: p } = ports({ getPending: () => Promise.reject(new Error('offline')) });

    await expect(autoSubmitFromMessage('Your code is 481920', p)).resolves.toBe('failed');
  });

  it('will not call a lost send a failure, because the code may have landed', async () => {
    // The request was already on its way when the connection went — a phone
    // leaving the house mid-send is the ordinary case here. The importer may
    // have taken the code and passed it to the bank, with only the answer lost.
    // Reporting that as a failure invites a caller to send it again, and a bank
    // grants only a handful of attempts before it locks the request out.
    const submit = jest.fn(() => Promise.reject(new Error('connection reset')));
    const { ports: p } = ports({ submit });

    await expect(autoSubmitFromMessage('Your code is 481920', p)).resolves.toBe('unknown');
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('keeps a code the importer never judged, rather than calling it refused', async () => {
    // A 503 says the code was not looked at. Reporting it as a refusal would
    // stop the retry above it and strand an unspent code over an outage that
    // clears in seconds.
    const { ports: p } = ports({
      submit: () => Promise.resolve({ ok: false, error: 'bad gateway', status: 503 }),
    });

    await expect(autoSubmitFromMessage('Your code is 481920', p)).resolves.toBe('failed');
  });

  it('tells a lost send apart from never having sent at all', async () => {
    // Both are "we could not finish", but only one leaves the code unspent, and
    // that difference is the whole reason a caller may retry one and not the
    // other.
    const lost = ports({ submit: () => Promise.reject(new Error('connection reset')) });
    const never = ports({ loadSession: () => Promise.reject(new Error('keystore locked')) });

    const [a, b] = await Promise.all([
      autoSubmitFromMessage('Your code is 481920', lost.ports),
      autoSubmitFromMessage('Your code is 481920', never.ports),
    ]);
    expect(a).toBe('unknown');
    expect(b).toBe('failed');
  });
});
