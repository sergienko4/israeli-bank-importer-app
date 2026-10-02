/**
 * Property-based test for a held code's send racing its own deadline.
 *
 * A drain's send waits its turn behind any change to the switches, then waits
 * for the importer, and the drain stops waiting at a deadline taken from its
 * lease. However the lease, the time spent waiting for the turn and the time
 * the importer takes to answer combine, a code is spent only if it was sent,
 * and nothing is sent after the drain has returned.
 */
import * as SecureStore from 'expo-secure-store';
import * as fc from 'fast-check';

import { submitOtpUnattended } from '../api/importerClient';
import type { SaveResult } from '../api/manifest';
import type { Connection } from '../auth/connectionStore';
import { loadConnection, saveConnection } from '../auth/connectionStore';
import { currentPairing } from '../auth/pairingGeneration';
import { processLedger } from '../auth/tokenLedger';
import { loadBackgroundCaptureAllowed, submitWhileAllowed } from './otpBackgroundGate';
import { createUnattendedSession } from './otpBackgroundSession';
import { writeSwitch } from './otpCaptureSwitch';
import { ACK_MARGIN_MS, MIN_SEND_MS, SUBMIT_DEADLINE_MS, TASK_BUDGET_MS } from './otpDeadline';
import type { StashedMessage } from './otpStash';
import { drainStash } from './otpStashDrain';
import { createSerialDrain } from './otpStashRunner';

jest.mock('expo-secure-store');
jest.mock('../api/importerClient', () => ({ submitOtpUnattended: jest.fn() }));
jest.mock('./biometrics', () => ({ authenticateBiometric: jest.fn() }));

const mockedGet = jest.mocked(SecureStore.getItemAsync);
const mockedSubmit = jest.mocked(submitOtpUnattended);

const NOW = 1_700_000_000_000;
const LIVE = { id: 'req-1', bankId: 'onezero', createdAt: NOW, deadline: NOW + 600_000 };
const CONNECTION: Connection = {
  baseUrl: 'https://a.example.ts.net',
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: NOW + 60 * 60_000,
};
const STORAGE = new Map([
  ['otp.autoRead.v1', 'true'],
  ['otp.autoSubmit.v1', 'true'],
  ['otp.channel.v1', 'app'],
  ['importer.connection.v2', JSON.stringify(CONNECTION)],
]);
/** A wait that is usually short, and sometimes long enough to outlast a send. */
const delay = fc.oneof(
  fc.integer({ min: 0, max: 2_000 }),
  fc.integer({ min: 0, max: 2 * SUBMIT_DEADLINE_MS }),
);
/** Longer than any lease, queue hold and reply combined, so every run settles. */
const SETTLE_ALL_MS = 4 * TASK_BUDGET_MS;

/**
 * How long a drain on this lease waits for its send, mirroring the drain.
 * @param lease - The lease the drain is given.
 * @returns The wait, which may be below the minimum the drain will send in.
 */
function allowanceFor(lease: number): number {
  return Math.min(SUBMIT_DEADLINE_MS, lease - ACK_MARGIN_MS);
}

/**
 * Waits on the fake clock.
 * @param ms - How long.
 * @returns Once that much fake time has passed.
 */
function after(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  mockedGet.mockImplementation((key) => Promise.resolve(STORAGE.get(key) ?? null));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('a held code sent against its deadline (property)', () => {
  it('is spent only if it was sent, and is never sent after the drain returns', async () => {
    const reached = { abandoned: 0, submitted: 0, unknown: 0 };
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          lease: fc.integer({ min: 0, max: TASK_BUDGET_MS }),
          hold: delay,
          // Most interesting when the queue frees right around the deadline.
          nearDeadline: fc.option(fc.integer({ min: -1_000, max: 1_000 }), {
            nil: undefined,
            freq: 1,
          }),
          reply: fc.option(delay, { nil: null }),
        }),
        async ({ lease, hold, nearDeadline, reply }) => {
          jest.setSystemTime(NOW);
          processLedger.forget();
          const events: string[] = [];
          let held: StashedMessage[] = [
            {
              id: 'msg-1',
              body: 'Your code is 481920',
              sender: 'BANK',
              receivedAt: NOW,
              attempted: [],
            },
          ];
          let acknowledged = false;
          mockedSubmit.mockReset();
          mockedSubmit.mockImplementation(() => {
            events.push('sent');
            return reply === null
              ? new Promise<SaveResult>(() => undefined)
              : after(reply).then(() => ({ ok: true }));
          });
          const drain = createSerialDrain((granted) =>
            drainStash({
              loadSession: () =>
                createUnattendedSession({
                  allowed: loadBackgroundCaptureAllowed,
                  load: loadConnection,
                  save: saveConnection,
                  refresh: () => Promise.reject(new Error('a live token needs no renewal')),
                  now: Date.now,
                  ledger: processLedger,
                  pairing: currentPairing,
                })(),
              getPending: () => Promise.resolve([LIVE]),
              submit: submitWhileAllowed,
              now: Date.now,
              list: () => Promise.resolve([...held]),
              consume: (id) => {
                acknowledged = true;
                held = held.filter((entry) => entry.id !== id);
                return Promise.resolve();
              },
              markAttempt: () => {
                acknowledged = true;
                return Promise.resolve();
              },
              stillOwned: granted.stillOwned,
              remainingMs: granted.remainingMs,
            }),
          );
          const queued =
            nearDeadline === undefined ? hold : Math.max(0, allowanceFor(lease) + nearDeadline);

          const switching = writeSwitch(() => after(queued));
          const draining = drain(() => lease).then((outcome) => {
            events.push('returned');
            return outcome;
          });
          await jest.advanceTimersByTimeAsync(SETTLE_ALL_MS);
          await switching;
          const outcome = await draining;

          const sends = events.filter((event) => event === 'sent').length;
          expect(sends).toBeLessThanOrEqual(1);
          expect(events).toContain('returned');
          expect(events.slice(events.indexOf('returned') + 1)).toEqual([]);
          // Sent if and only if spent: a code that never left the device stays
          // on offer, and one that did is never offered again.
          expect(acknowledged).toBe(sends === 1);
          expect(sends === 1 ? ['submitted', 'unknown'] : ['superseded']).toContain(outcome);

          if (outcome === 'submitted' || outcome === 'unknown') reached[outcome] += 1;
          if (sends === 0 && allowanceFor(lease) >= MIN_SEND_MS) reached.abandoned += 1;
        },
      ),
      { numRuns: 300 },
    );

    // Each must actually happen, or the property passes without testing them.
    expect(reached.abandoned).toBeGreaterThan(0);
    expect(reached.submitted).toBeGreaterThan(0);
    expect(reached.unknown).toBeGreaterThan(0);
  });
});
