/**
 * Regression tests for a send that is still waiting its turn when its drain
 * stops waiting for it.
 *
 * A background send starts in turn with the user's switch changes, so a slow
 * switch write holds it in the queue. The drain only waits as long as its lease
 * allows. If the send had not started by then the code never left the device,
 * so it has to stay held, and the send must not go out when the queue frees.
 */
import * as SecureStore from 'expo-secure-store';

import { submitOtpUnattended } from '../api/importerClient';
import { type Connection, loadConnection, saveConnection } from '../auth/connectionStore';
import { currentPairing } from '../auth/pairingGeneration';
import { processLedger } from '../auth/tokenLedger';
import { loadBackgroundCaptureAllowed, submitWhileAllowed } from './otpBackgroundGate';
import { createUnattendedSession } from './otpBackgroundSession';
import { writeSwitch } from './otpCaptureSwitch';
import { ACK_MARGIN_MS } from './otpDeadline';
import type { StashedMessage } from './otpStash';
import { drainStash } from './otpStashDrain';
import { createSerialDrain } from './otpStashRunner';

jest.mock('expo-secure-store');
jest.mock('../api/importerClient', () => ({ submitOtpUnattended: jest.fn() }));
jest.mock('./biometrics', () => ({ authenticateBiometric: jest.fn() }));

const mockedGet = jest.mocked(SecureStore.getItemAsync);
const mockedSubmit = jest.mocked(submitOtpUnattended);

const NOW = 1_700_000_000_000;
const LEASE_MS = 20_000;
/** What the drain gives the send out of {@link LEASE_MS}. */
const ALLOWANCE_MS = LEASE_MS - ACK_MARGIN_MS;
const LIVE = { id: 'req-1', bankId: 'onezero', createdAt: NOW, deadline: NOW + 120_000 };
const CONNECTION: Connection = {
  baseUrl: 'https://a.example.ts.net',
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: NOW + 15 * 60_000,
};

let held: StashedMessage[];
let spent: string[];
let drainHeld: ReturnType<typeof createSerialDrain>;
/** Frees every queue a test held, so one failing test cannot stall the next. */
let releases: (() => void)[];

/**
 * Loads a session the way background capture does, under the refresh lock.
 * @returns The stored session, labelled with the pairing in force.
 */
function loadSession(): ReturnType<ReturnType<typeof createUnattendedSession>> {
  return createUnattendedSession({
    allowed: loadBackgroundCaptureAllowed,
    load: loadConnection,
    save: saveConnection,
    refresh: () => Promise.reject(new Error('a live token needs no renewal')),
    now: Date.now,
    ledger: processLedger,
    pairing: currentPairing,
  })();
}

/**
 * One held-message drain at a time, each on its own lease.
 * @returns A serial drain over this test's held messages.
 */
function serialDrain(): ReturnType<typeof createSerialDrain> {
  return createSerialDrain((lease) =>
    drainStash({
      loadSession,
      getPending: () => Promise.resolve([LIVE]),
      submit: submitWhileAllowed,
      now: Date.now,
      list: () => Promise.resolve([...held]),
      consume: (id) => {
        held = held.filter((entry) => entry.id !== id);
        return Promise.resolve();
      },
      markAttempt: (id, requestId) => {
        spent.push(`${id}:${requestId}`);
        return Promise.resolve();
      },
      stillOwned: lease.stillOwned,
      remainingMs: lease.remainingMs,
    }),
  );
}

/**
 * Holds the switch queue the way a slow switch write would.
 * @returns Lets the write finish, and with it the queue behind it.
 */
function holdSwitchQueue(): () => Promise<void> {
  let finish = (): void => undefined;
  const writing = writeSwitch(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  releases.push(() => {
    finish();
  });
  return async () => {
    finish();
    await writing;
  };
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  jest.clearAllMocks();
  processLedger.forget();
  const storage = new Map([
    ['otp.autoRead.v1', 'true'],
    ['otp.autoSubmit.v1', 'true'],
    ['otp.channel.v1', 'app'],
    ['importer.connection.v2', JSON.stringify(CONNECTION)],
  ]);
  mockedGet.mockImplementation((key) => Promise.resolve(storage.get(key) ?? null));
  mockedSubmit.mockResolvedValue({ ok: true });
  held = [
    { id: 'msg-1', body: 'Your code is 481920', sender: 'BANK', receivedAt: NOW, attempted: [] },
  ];
  spent = [];
  releases = [];
  drainHeld = serialDrain();
});

afterEach(() => {
  for (const release of releases) release();
  jest.useRealTimers();
});

describe('a held code whose send is still queued when the drain stops waiting', () => {
  it('stays held and unspent, and is not sent when the queue frees', async () => {
    const release = holdSwitchQueue();
    const draining = drainHeld(() => LEASE_MS);

    await jest.advanceTimersByTimeAsync(ALLOWANCE_MS);

    await expect(draining).resolves.toBe('superseded');
    expect(held.map((entry) => entry.id)).toEqual(['msg-1']);
    expect(spent).toEqual([]);

    // The queue frees once the drain has given up and the lease is gone.
    await jest.advanceTimersByTimeAsync(LEASE_MS);
    await release();
    await jest.advanceTimersByTimeAsync(0);

    expect(mockedSubmit).not.toHaveBeenCalled();
  });

  it('is sent exactly once by the next drain', async () => {
    const release = holdSwitchQueue();
    const first = drainHeld(() => LEASE_MS);
    await jest.advanceTimersByTimeAsync(LEASE_MS);
    await release();
    await expect(first).resolves.toBe('superseded');

    await expect(drainHeld(() => LEASE_MS)).resolves.toBe('submitted');

    expect(mockedSubmit).toHaveBeenCalledTimes(1);
    expect(held).toEqual([]);
  });
});

describe('a held code whose send gets its turn within the allowance', () => {
  it('is sent once and consumed', async () => {
    const release = holdSwitchQueue();
    const draining = drainHeld(() => LEASE_MS);

    await jest.advanceTimersByTimeAsync(ALLOWANCE_MS / 2);
    await release();

    await expect(draining).resolves.toBe('submitted');
    expect(mockedSubmit).toHaveBeenCalledTimes(1);
    expect(held).toEqual([]);
    expect(spent).toEqual([]);
  });
});
