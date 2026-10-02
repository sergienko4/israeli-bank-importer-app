/**
 * Regression tests for a sign-in or Disconnect that lands inside a capture.
 *
 * Each test fixes one order of events that the property beside this file only
 * reaches by chance: a capture loads importer A's session, and the user moves
 * away from A before the capture sends. The code must not go to A.
 */
import * as SecureStore from 'expo-secure-store';

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
 * @returns The pair as storage keeps it, with a live access token.
 */
function pairFor(baseUrl: string): Connection {
  return {
    baseUrl,
    accessToken: `access-${baseUrl}`,
    refreshToken: `refresh-${baseUrl}`,
    expiresAt: NOW + TOKEN_TTL,
  };
}

const userChanges: [string, () => Promise<unknown>][] = [
  ['signs in to another importer', () => adoptConnection(pairFor(IMPORTER_B))],
  ['disconnects', () => dropConnection()],
];

let storage: Map<string, string>;
let held: StashedMessage[];

/**
 * Loads a session the way background capture does, under the refresh lock.
 * @returns The session for the pairing stored now, labelled with its number.
 */
function loadSession(): ReturnType<ReturnType<typeof createUnattendedSession>> {
  return createUnattendedSession({
    allowed: loadBackgroundCaptureAllowed,
    load: loadConnection,
    save: saveConnection,
    refresh: () => Promise.reject(new Error('a live token needs no renewal')),
    now: () => NOW,
    ledger: processLedger,
    pairing: currentPairing,
  })();
}

beforeEach(() => {
  jest.clearAllMocks();
  processLedger.forget();
  storage = new Map([
    ['otp.autoRead.v1', 'true'],
    ['otp.autoSubmit.v1', 'true'],
    ['otp.channel.v1', 'app'],
    [CONNECTION_KEY, JSON.stringify(pairFor(IMPORTER_A))],
  ]);
  held = [message('old', '481920')];
  mockedGet.mockImplementation((key) => Promise.resolve(storage.get(key) ?? null));
  mockedSet.mockImplementation((key, value) => {
    storage.set(key, value);
    return Promise.resolve();
  });
  mockedDelete.mockImplementation((key) => {
    storage.delete(key);
    return Promise.resolve();
  });
  mockedForget.mockImplementation(() => {
    held = [];
    return Promise.resolve();
  });
  mockedSubmit.mockResolvedValue({ ok: true });
});

describe('a drain that loaded the session before the user moved away', () => {
  it.each(userChanges)(
    'does not send a code that arrived after the user %s',
    async (_label, change) => {
      let reads = 0;
      const outcome = await drainStash({
        loadSession,
        getPending: () => Promise.resolve([LIVE]),
        submit: submitWhileAllowed,
        now: () => NOW,
        list: async () => {
          reads += 1;
          if (reads === 2) {
            // Between loading A's session and reading the held messages again,
            // the change forgets A's code and a new text arrives.
            await change();
            held = [message('new', '735102')];
          }
          return [...held];
        },
        consume: (id) => {
          held = held.filter((entry) => entry.id !== id);
          return Promise.resolve();
        },
        markAttempt: () => Promise.resolve(),
        stillOwned: () => true,
        remainingMs: () => 60_000,
      });

      expect(reads).toBe(2);
      expect(outcome).toBe('not-allowed');
      expect(mockedSubmit).not.toHaveBeenCalled();
      // Refused before it left the device, so the code stays held for a capture
      // made over the pairing the user is on now.
      expect(held.map((entry) => entry.id)).toEqual(['new']);
    },
  );
});

describe('a capture from the waking message that loaded the session first', () => {
  it.each(userChanges)(
    'does not send the code when the user %s before it is sent',
    async (_label, change) => {
      const outcome = await autoSubmitFromMessage('Your code is 481920', {
        loadSession,
        getPending: async () => {
          await change();
          return [LIVE];
        },
        submit: submitWhileAllowed,
        now: () => NOW,
        remainingMs: () => 60_000,
      });

      expect(outcome).toBe('not-allowed');
      expect(mockedSubmit).not.toHaveBeenCalled();
    },
  );
});
