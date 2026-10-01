/**
 * Property-based test for a sign-in or Disconnect while background capture runs.
 *
 * A capture loads a session, then reads the held messages and the importer's
 * pending request before it sends a code, and the user can sign in to another
 * importer or disconnect during any of those waits. A message can also arrive
 * at any moment, including just after the change forgot the ones held before
 * it. Whichever path the code takes — straight from the message that woke the
 * app, or from the held messages — nothing may go to the importer the user
 * moved away from once the change is stored.
 */
import * as SecureStore from 'expo-secure-store';
import * as fc from 'fast-check';

import { submitOtpUnattended } from '../api/importerClient';
import { adoptConnection, dropConnection } from '../auth/appSession';
import { type Connection, loadConnection, saveConnection } from '../auth/connectionStore';
import { currentPairing } from '../auth/pairingGeneration';
import { processLedger } from '../auth/tokenLedger';
import { loadBackgroundCaptureAllowed, submitWhileAllowed } from './otpBackgroundGate';
import { createUnattendedSession } from './otpBackgroundSession';
import { autoSubmitFromMessage } from './otpBackgroundSubmit';
import type { StashedMessage } from './otpStash';
import { drainStash } from './otpStashDrain';
import { forgetHeldMessages } from './otpStashGate';

jest.mock('expo-secure-store');
jest.mock('../api/importerClient', () => ({ submitOtpUnattended: jest.fn() }));
jest.mock('./biometrics', () => ({ authenticateBiometric: jest.fn() }));
jest.mock('./otpStashGate', () => ({ forgetHeldMessages: jest.fn() }));

const mockedGet = jest.mocked(SecureStore.getItemAsync);
const mockedSet = jest.mocked(SecureStore.setItemAsync);
const mockedDelete = jest.mocked(SecureStore.deleteItemAsync);
const mockedSubmit = jest.mocked(submitOtpUnattended);
const mockedForget = jest.mocked(forgetHeldMessages);

const NOW = 1_700_000_000_000;
const TOKEN_TTL = 15 * 60_000;
const CONNECTION_KEY = 'importer.connection.v2';
const IMPORTER_A = 'https://a.example.ts.net';
const IMPORTER_B = 'https://b.example.ts.net';
const LIVE = { id: 'req-1', bankId: 'onezero', createdAt: NOW, deadline: NOW + 60_000 };

type Change = 'sign-in' | 'disconnect';
type Path = 'from-message' | 'from-held';

/**
 * A held message carrying one code.
 * @param id - The message's identity.
 * @param code - The code in its body.
 * @returns The message as the native side would hold it.
 */
function message(id: string, code: string): StashedMessage {
  return {
    id,
    body: `Your code is ${code}`,
    sender: 'BANK',
    receivedAt: NOW - 1_000,
    attempted: [],
  };
}

/**
 * The pair a sign-in to an importer would be issued.
 * @param baseUrl - The importer signed in to.
 * @param expiresAt - When its access token expires.
 * @returns The pair as storage keeps it.
 */
function pairFor(baseUrl: string, expiresAt: number): Connection {
  return {
    baseUrl,
    accessToken: `access-${baseUrl}`,
    refreshToken: `refresh-${baseUrl}`,
    expiresAt,
  };
}

describe('changing the pairing while capture runs (property)', () => {
  let sentToA = 0;

  afterAll(() => {
    // Guards against a property that holds only because no code ever went out.
    expect(sentToA).toBeGreaterThan(0);
  });

  it('sends no code to the importer the user moved away from', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.scheduler(),
        fc.record({
          expired: fc.boolean(),
          captures: fc.integer({ min: 1, max: 2 }),
          change: fc.constantFrom<Change>('sign-in', 'disconnect'),
          path: fc.constantFrom<Path>('from-message', 'from-held'),
        }),
        async (s, { expired, captures, change, path }) => {
          processLedger.forget();
          const storage = new Map<string, string>([
            ['otp.autoRead.v1', 'true'],
            ['otp.autoSubmit.v1', 'true'],
            ['otp.channel.v1', 'app'],
            [
              CONNECTION_KEY,
              JSON.stringify(pairFor(IMPORTER_A, expired ? NOW - 1 : NOW + TOKEN_TTL)),
            ],
          ]);
          let held: StashedMessage[] = [message('old', '481920')];
          const events: string[] = [];
          const later = <T>(effect: () => T): Promise<T> =>
            s.schedule(Promise.resolve()).then(effect);

          // A read samples storage when it is asked, so it can answer for the
          // moment before a write that lands while it is still on its way.
          mockedGet.mockImplementation((key) => {
            const value = storage.get(key) ?? null;
            return later(() => value);
          });
          mockedSet.mockImplementation((key, value) =>
            later(() => {
              storage.set(key, value);
              if (key === CONNECTION_KEY && value.includes(IMPORTER_B)) events.push('B stored');
            }),
          );
          mockedDelete.mockImplementation((key) =>
            later(() => {
              storage.delete(key);
              if (key === CONNECTION_KEY) events.push('A cleared');
            }),
          );
          mockedForget.mockImplementation(() =>
            later(() => {
              held = [];
            }),
          );
          mockedSubmit.mockImplementation((session) => {
            events.push(`sent to ${session.baseUrl}`);
            return later(() => ({ ok: true }));
          });

          const loader = createUnattendedSession({
            allowed: loadBackgroundCaptureAllowed,
            load: loadConnection,
            save: saveConnection,
            refresh: (baseUrl) =>
              later(() => ({
                accessToken: `access-renewed-${baseUrl}`,
                refreshToken: `refresh-renewed-${baseUrl}`,
                expiresAt: NOW + TOKEN_TTL,
              })),
            now: () => NOW,
            ledger: processLedger,
            pairing: currentPairing,
          });
          const ports = {
            loadSession: () => loader(),
            getPending: () => later(() => [LIVE]),
            submit: submitWhileAllowed,
            now: () => NOW,
          };
          const capture = (): Promise<unknown> =>
            later(() =>
              path === 'from-message'
                ? autoSubmitFromMessage('Your code is 481920', ports)
                : drainStash({
                    ...ports,
                    list: () => later(() => [...held]),
                    consume: (id) =>
                      later(() => {
                        held = held.filter((entry) => entry.id !== id);
                      }),
                    markAttempt: (id, requestId) =>
                      later(() => {
                        held = held.map((entry) =>
                          entry.id === id
                            ? { ...entry, attempted: [...entry.attempted, requestId] }
                            : entry,
                        );
                      }),
                    stillOwned: () => true,
                    remainingMs: () => 60_000,
                  }),
            ).catch(() => 'threw');
          const arrival = later(() => {
            held = [...held, message('new', '735102')];
          });
          // Every capture and the change start at a moment the scheduler picks,
          // so the change can land before a session is loaded, between the load
          // and the send, or after the send.
          const userChange = later(() =>
            change === 'sign-in'
              ? adoptConnection(pairFor(IMPORTER_B, NOW + TOKEN_TTL))
              : dropConnection(),
          );

          await s.waitFor(
            Promise.all([...Array.from({ length: captures }, capture), arrival, userChange]),
          );

          const changed = events.findIndex(
            (event) => event === 'B stored' || event === 'A cleared',
          );
          if (events.includes(`sent to ${IMPORTER_A}`)) sentToA += 1;
          expect(changed).toBeGreaterThanOrEqual(0);
          expect(events.slice(changed + 1)).not.toContain(`sent to ${IMPORTER_A}`);
        },
      ),
      { numRuns: 1000 },
    );
  });
});
