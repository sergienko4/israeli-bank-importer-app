/**
 * Property-based test for turning background capture off while it runs.
 *
 * A capture reads the switches, loads a session (renewing it when the stored
 * token is stale), fetches the request it answers, and sends the code. Each of
 * those is a wait the user can turn capture off during, and a storage read can
 * answer for the moment before the switch moved. However those waits
 * interleave with any of the three switches being stored, nothing may start
 * spending a refresh token or sending a code once the switch-off is stored.
 */
import * as SecureStore from 'expo-secure-store';
import * as fc from 'fast-check';

import { submitOtpUnattended } from '../api/importerClient';
import type { Connection } from '../auth/connectionStore';
import { currentPairing } from '../auth/pairingGeneration';
import { createTokenLedger } from '../auth/tokenLedger';
import { saveOtpAutoRead } from './otpAutoReadStore';
import { saveOtpAutoSubmit } from './otpAutoSubmitStore';
import { loadBackgroundCaptureAllowed, submitWhileAllowed } from './otpBackgroundGate';
import { createUnattendedSession } from './otpBackgroundSession';
import { autoSubmitFromMessage } from './otpBackgroundSubmit';
import { saveOtpChannel } from './otpChannelStore';

jest.mock('expo-secure-store');
jest.mock('../api/importerClient', () => ({ submitOtpUnattended: jest.fn() }));

const mockedGet = jest.mocked(SecureStore.getItemAsync);
const mockedSet = jest.mocked(SecureStore.setItemAsync);
const mockedSubmit = jest.mocked(submitOtpUnattended);

const NOW = 1_700_000_000_000;
const TOKEN_TTL = 15 * 60_000;
const BASE_URL = 'https://importer.example.ts.net';
const LIVE = { id: 'req-1', bankId: 'onezero', createdAt: NOW, deadline: NOW + 60_000 };

type Switch = 'auto-read' | 'auto-submit' | 'channel';

const TURN_OFF: Record<Switch, () => Promise<void>> = {
  'auto-read': () => saveOtpAutoRead(false),
  'auto-submit': () => saveOtpAutoSubmit(false),
  channel: () => saveOtpChannel('telegram'),
};

describe('turning capture off while it runs (property)', () => {
  it('starts no renewal and sends no code once the switch-off is stored', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.scheduler(),
        fc.record({
          expired: fc.boolean(),
          captures: fc.integer({ min: 1, max: 2 }),
          turnedOff: fc.constantFrom<Switch>('auto-read', 'auto-submit', 'channel'),
        }),
        async (s, { expired, captures, turnedOff }) => {
          const storage = new Map<string, string>([
            ['otp.autoRead.v1', 'true'],
            ['otp.autoSubmit.v1', 'true'],
            ['otp.channel.v1', 'app'],
          ]);
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
              events.push('switch-off stored');
            }),
          );
          mockedSubmit.mockImplementation(() => {
            events.push('code sent');
            return later(() => ({ ok: true }));
          });

          let stored: Connection = {
            baseUrl: BASE_URL,
            accessToken: 'access-0',
            refreshToken: 'refresh-0',
            expiresAt: expired ? NOW - 1 : NOW + TOKEN_TTL,
          };
          const loader = createUnattendedSession({
            allowed: loadBackgroundCaptureAllowed,
            load: () => later(() => stored),
            save: (next) =>
              later(() => {
                stored = next;
              }),
            refresh: () => {
              events.push('token spent');
              return later(() => ({
                accessToken: 'access-1',
                refreshToken: 'refresh-1',
                expiresAt: NOW + TOKEN_TTL,
              }));
            },
            now: () => NOW,
            ledger: createTokenLedger(),
            pairing: currentPairing,
          });
          const capture = (): Promise<string> =>
            autoSubmitFromMessage('Your code is 481920', {
              loadSession: () => loader(),
              getPending: () => later(() => [LIVE]),
              submit: submitWhileAllowed,
              now: () => NOW,
              remainingMs: () => 60_000,
            }).catch(() => 'threw');

          await s.waitFor(
            Promise.all([...Array.from({ length: captures }, capture), TURN_OFF[turnedOff]()]),
          );

          const off = events.indexOf('switch-off stored');
          expect(off).toBeGreaterThanOrEqual(0);
          expect(events.slice(off + 1)).toEqual([]);
        },
      ),
      { numRuns: 1000 },
    );
  });
});
