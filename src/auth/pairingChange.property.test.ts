/**
 * Property-based tests for what survives a pairing change on the screen.
 *
 * The screen renews after an unlock, sign-in replaces the pairing, Disconnect
 * removes it, and the receiver holds codes all the while — and the secure store
 * can refuse to read or write at any point. For every such interleaving the
 * portal must never see a refresh token twice, storage and screen must end on
 * the pairing the user last chose, and no held code may outlive the pairing it
 * was captured for, because draining it later would send it to another one.
 */
import * as fc from 'fast-check';

import { type AppTokens, refreshTokens, SessionEndedError } from '../api/appTokens';
import { authenticateBiometric } from '../lib/biometrics';
import { forgetHeldMessages } from '../lib/otpStashGate';
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
jest.mock('../lib/otpStashGate', () => ({ forgetHeldMessages: jest.fn() }));
jest.mock('./connectionStore', () => ({
  clearConnection: jest.fn(),
  loadConnection: jest.fn(),
  saveConnection: jest.fn(),
}));

const mockedRefresh = refreshTokens as jest.MockedFunction<typeof refreshTokens>;
const mockedUnlock = authenticateBiometric as jest.MockedFunction<typeof authenticateBiometric>;
const mockedForgetHeld = forgetHeldMessages as jest.MockedFunction<typeof forgetHeldMessages>;
const mockedLoad = loadConnection as jest.MockedFunction<typeof loadConnection>;
const mockedSave = saveConnection as jest.MockedFunction<typeof saveConnection>;
const mockedClear = clearConnection as jest.MockedFunction<typeof clearConnection>;

const NOW = 1_700_000_000_000;
const TOKEN_TTL = 15 * 60_000;
const IMPORTER_A = 'https://a.example.ts.net';
const IMPORTER_B = 'https://b.example.ts.net';

type Op =
  | { readonly kind: 'unlock'; readonly approved: boolean }
  | { readonly kind: 'disconnect' }
  | { readonly kind: 'connect'; readonly baseUrl: string }
  | { readonly kind: 'hold' };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant('unlock' as const), approved: fc.boolean() }),
  fc.constant<Op>({ kind: 'disconnect' }),
  fc.record({
    kind: fc.constant('connect' as const),
    baseUrl: fc.constantFrom(IMPORTER_A, IMPORTER_B),
  }),
  fc.constant<Op>({ kind: 'hold' }),
);

/**
 * A portal that rotates like the real one: each session has one live refresh
 * token, and presenting any other token of that session ends it.
 * @returns The portal's operations and the replays it saw.
 */
function portal() {
  let issued = 0;
  let sessions = 0;
  const live = new Map<number, string>();
  const sessionOfToken = new Map<string, number>();
  const ended = new Set<number>();
  const replays: string[] = [];

  const issue = (session: number): AppTokens => {
    issued += 1;
    const tokens = {
      accessToken: `access-${String(issued)}`,
      refreshToken: `refresh-${String(issued)}`,
      expiresAt: NOW + TOKEN_TTL,
    };
    live.set(session, tokens.refreshToken);
    sessionOfToken.set(tokens.refreshToken, session);
    return tokens;
  };

  return {
    replays,
    sessionOf: (pair: Connection | null): number | null =>
      pair === null ? null : (sessionOfToken.get(pair.refreshToken) ?? -1),
    signIn: (baseUrl: string): Connection => {
      sessions += 1;
      return { baseUrl, ...issue(sessions) };
    },
    refresh: (refreshToken: string): AppTokens => {
      const session = sessionOfToken.get(refreshToken);
      if (session === undefined || ended.has(session)) throw new SessionEndedError();
      if (live.get(session) !== refreshToken) {
        replays.push(refreshToken);
        ended.add(session);
        throw new SessionEndedError();
      }
      return issue(session);
    },
  };
}

describe('pairing changes on the screen (property)', () => {
  it('never replays, ends where the user left it, and holds no code from another pairing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.scheduler(),
        fc.record({
          ops: fc.array(opArb, { minLength: 1, maxLength: 6 }),
          loadFailures: fc.array(fc.boolean(), { maxLength: 8 }),
          saveFailures: fc.array(fc.boolean(), { maxLength: 8 }),
        }),
        async (s, { ops, loadFailures, saveFailures }) => {
          processLedger.forget();
          const importer = portal();
          const initial = importer.signIn(IMPORTER_A);
          let stored: Connection | null = initial;
          let screen: Connection | null = initial;
          let expected = importer.sessionOf(initial);
          let held: (number | null)[] = [];
          const unreadable = [...loadFailures];
          const unwritable = [...saveFailures];
          const unlocks: boolean[] = [];

          const later = <T>(effect: () => T): Promise<T> =>
            s.schedule(Promise.resolve()).then(effect);

          mockedLoad.mockImplementation(() =>
            later(() => {
              if (unreadable.shift() === true) throw new Error('Keystore unavailable.');
              return stored;
            }),
          );
          mockedSave.mockImplementation((next) =>
            later(() => {
              if (unwritable.shift() === true) throw new Error('Keystore unavailable.');
              stored = next;
            }),
          );
          mockedClear.mockImplementation(() =>
            later(() => {
              stored = null;
            }),
          );
          mockedForgetHeld.mockImplementation(() =>
            later(() => {
              held = [];
            }),
          );
          mockedRefresh.mockImplementation((_baseUrl, token) =>
            later(() => importer.refresh(token)),
          );
          mockedUnlock.mockImplementation(() => {
            const approved = unlocks.shift() === true;
            return later(() => (approved ? { status: 'success' } : { status: 'failed' }));
          });

          // Mirrors AuthContext: an ended renewal drops only the pairing it
          // judged, and the screen lets go only when that drop happened.
          const run = async (op: Op): Promise<void> => {
            switch (op.kind) {
              case 'unlock': {
                if (screen === null) return;
                unlocks.push(op.approved);
                const outcome = await refreshConnection();
                if (outcome.status === 'refreshed') {
                  screen = outcome.connection;
                } else if (outcome.status === 'ended' && (await dropConnection(outcome.pairing))) {
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
                return;
              }
              case 'hold':
                await later(() => {
                  held.push(importer.sessionOf(stored));
                });
            }
          };

          await s.waitFor(Promise.all(ops.map(run)));

          // Read through a function: the ops reassign these inside closures,
          // which the compiler's narrowing from the declarations cannot see.
          const settled = () => ({ stored, screen, held });
          const end = settled();
          expect(importer.replays).toEqual([]);
          expect(importer.sessionOf(end.stored)).toBe(expected);
          expect(importer.sessionOf(end.screen)).toBe(expected);
          expect(end.held.filter((owner) => owner !== expected)).toEqual([]);
        },
      ),
      { numRuns: 1000 },
    );
  });
});
