/**
 * Property-based tests for who holds the live refresh token across the app.
 *
 * The screen renews after an unlock, the background capture renews with nobody
 * there, sign-in replaces the pairing, and Disconnect removes it — and any of
 * these can overlap while the secure store refuses writes. For every such
 * interleaving the portal must never see a refresh token twice, storage must
 * never hold an access token the background obtained without an unlock, and
 * once the last sign-in or disconnect has finished, storage and screen must
 * both belong to it rather than to a renewal that finished late.
 */
import * as fc from 'fast-check';

import { type AppTokens, refreshTokens, SessionEndedError } from '../api/appTokens';
import { authenticateBiometric } from '../lib/biometrics';
import { createUnattendedSession } from '../lib/otpBackgroundSession';
import { adoptConnection, dropConnection, refreshConnection } from './appSession';
import {
  clearConnection,
  type Connection,
  loadConnection,
  saveConnection,
} from './connectionStore';
import { processLedger } from './tokenLedger';

jest.mock('../api/appTokens', () => ({
  ...jest.requireActual<Record<string, unknown>>('../api/appTokens'),
  refreshTokens: jest.fn(),
}));
jest.mock('../lib/biometrics', () => ({ authenticateBiometric: jest.fn() }));
jest.mock('./connectionStore', () => ({
  clearConnection: jest.fn(),
  loadConnection: jest.fn(),
  saveConnection: jest.fn(),
}));

const mockedRefresh = refreshTokens as jest.MockedFunction<typeof refreshTokens>;
const mockedUnlock = authenticateBiometric as jest.MockedFunction<typeof authenticateBiometric>;
const mockedLoad = loadConnection as jest.MockedFunction<typeof loadConnection>;
const mockedSave = saveConnection as jest.MockedFunction<typeof saveConnection>;
const mockedClear = clearConnection as jest.MockedFunction<typeof clearConnection>;

const NOW = 1_700_000_000_000;
const TOKEN_TTL = 15 * 60_000;
const IMPORTER_A = 'https://a.example.ts.net';
const IMPORTER_B = 'https://b.example.ts.net';

type Op =
  | { readonly kind: 'capture' }
  | { readonly kind: 'unlock'; readonly approved: boolean }
  | { readonly kind: 'disconnect' }
  | { readonly kind: 'connect'; readonly baseUrl: string };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.constant<Op>({ kind: 'capture' }),
  fc.record({ kind: fc.constant('unlock' as const), approved: fc.boolean() }),
  fc.constant<Op>({ kind: 'disconnect' }),
  fc.record({
    kind: fc.constant('connect' as const),
    baseUrl: fc.constantFrom(IMPORTER_A, IMPORTER_B),
  }),
);

/**
 * A portal that rotates like the real one: each session has one live refresh
 * token, and presenting any other token of that session ends it.
 * @returns The portal's operations and what it observed.
 */
function portal() {
  let issued = 0;
  let sessions = 0;
  const live = new Map<number, string>();
  const sessionOfToken = new Map<string, number>();
  const ended = new Set<number>();
  const replays: string[] = [];
  const backgroundAccess = new Set<string>();

  const issue = (session: number, expiresAt: number): AppTokens => {
    issued += 1;
    const tokens = {
      accessToken: `access-${String(issued)}`,
      refreshToken: `refresh-${String(issued)}`,
      expiresAt,
    };
    live.set(session, tokens.refreshToken);
    sessionOfToken.set(tokens.refreshToken, session);
    return tokens;
  };

  return {
    replays,
    backgroundAccess,
    sessionOf: (pair: Connection | null): number | null =>
      pair === null ? null : (sessionOfToken.get(pair.refreshToken) ?? -1),
    signIn: (baseUrl: string, expiresAt = NOW + TOKEN_TTL): Connection => {
      sessions += 1;
      return { baseUrl, ...issue(sessions, expiresAt) };
    },
    refresh: (holder: 'screen' | 'background', refreshToken: string): AppTokens => {
      const session = sessionOfToken.get(refreshToken);
      if (session === undefined || ended.has(session)) throw new SessionEndedError();
      if (live.get(session) !== refreshToken) {
        replays.push(refreshToken);
        ended.add(session);
        throw new SessionEndedError();
      }
      const tokens = issue(session, NOW + TOKEN_TTL);
      if (holder === 'background') backgroundAccess.add(tokens.accessToken);
      return tokens;
    },
  };
}

describe('refresh-token ownership across screen and background (property)', () => {
  it('never replays, never stores a background access token, and ends where the user left it', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.scheduler(),
        fc.record({
          startsExpired: fc.boolean(),
          ops: fc.array(opArb, { minLength: 1, maxLength: 6 }),
          saveFailures: fc.array(fc.boolean(), { maxLength: 8 }),
        }),
        async (s, { startsExpired, ops, saveFailures }) => {
          processLedger.forget();
          const importer = portal();
          const initial = importer.signIn(IMPORTER_A, startsExpired ? NOW - 1 : NOW + TOKEN_TTL);
          let stored: Connection | null = initial;
          let screen: Connection | null = initial;
          let expected = importer.sessionOf(initial);
          const failures = [...saveFailures];
          const unlocks: boolean[] = [];
          const captureErrors: unknown[] = [];

          const later = <T>(effect: () => T): Promise<T> =>
            s.schedule(Promise.resolve()).then(effect);
          const load = (): Promise<Connection | null> => later(() => stored);
          const save = (next: Connection): Promise<void> =>
            later(() => {
              if (failures.shift() === true) throw new Error('Keystore unavailable.');
              stored = next;
            });

          mockedLoad.mockImplementation(load);
          mockedSave.mockImplementation(save);
          mockedClear.mockImplementation(() =>
            later(() => {
              stored = null;
            }),
          );
          mockedRefresh.mockImplementation((_baseUrl, token) =>
            later(() => importer.refresh('screen', token)),
          );
          mockedUnlock.mockImplementation(() => {
            const approved = unlocks.shift() === true;
            return later(() => (approved ? { status: 'success' } : { status: 'failed' }));
          });
          const capture = createUnattendedSession({
            allowed: () => Promise.resolve(true),
            load,
            save,
            refresh: (_baseUrl, token) => later(() => importer.refresh('background', token)),
            now: () => NOW,
            ledger: processLedger,
          });

          const run = async (op: Op): Promise<void> => {
            switch (op.kind) {
              case 'capture':
                await capture().catch((error: unknown) => {
                  captureErrors.push(error);
                });
                return;
              case 'unlock': {
                if (screen === null) return;
                unlocks.push(op.approved);
                const outcome = await refreshConnection();
                if (outcome.status === 'refreshed') {
                  screen = outcome.connection;
                } else if (outcome.status === 'ended') {
                  await dropConnection();
                  screen = null;
                  expected = null;
                }
                return;
              }
              case 'disconnect':
                await dropConnection();
                screen = null;
                expected = null;
                return;
              case 'connect': {
                const next = await later(() => importer.signIn(op.baseUrl));
                try {
                  await adoptConnection(next);
                } catch {
                  return;
                }
                screen = next;
                expected = importer.sessionOf(next);
              }
            }
          };

          await s.waitFor(Promise.all(ops.map(run)));

          // Read through a function: the ops reassign these inside closures,
          // which the compiler's narrowing from the declarations cannot see.
          const settled = (): { stored: Connection | null; screen: Connection | null } => ({
            stored,
            screen,
          });
          const end = settled();
          expect(importer.replays).toEqual([]);
          expect(captureErrors).toEqual([]);
          expect(importer.sessionOf(end.stored)).toBe(expected);
          expect(importer.sessionOf(end.screen)).toBe(expected);
          expect(importer.backgroundAccess.has(end.stored?.accessToken ?? '')).toBe(false);
        },
      ),
      // Disconnect landing between a capture's read and its save is a narrow
      // interleaving; 100 runs miss it, 1000 find it every time.
      { numRuns: 1000 },
    );
  });
});
