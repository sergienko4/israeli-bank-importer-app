/**
 * Property-based tests for a refresh whose reply arrives after its caller has
 * stopped waiting.
 *
 * The portal rotates a refresh token the moment it accepts it, and ends the
 * whole token family when a spent one comes back. A reply that arrives after
 * the caller's deadline still carries the only live token, so for any run of
 * renewals — from the screen or the background, answered at once or late, with
 * the headers or the body stalling — the portal must never see a spent token,
 * storage must end up naming the live one, and a caller on its own must still
 * get its answer within the deadline.
 */
import * as fc from 'fast-check';

import { NO_RESPONSE } from '../api/timedFetch';
import { authenticateBiometric } from '../lib/biometrics';
import { loadBackgroundCaptureAllowed } from '../lib/otpBackgroundGate';
import { loadUnattendedSession } from '../lib/otpBackgroundSession';
import { refreshConnection } from './appSession';
import { type Connection, loadConnection, saveConnection } from './connectionStore';
import { processLedger } from './tokenLedger';

jest.mock('../lib/biometrics', () => ({ authenticateBiometric: jest.fn() }));
jest.mock('../lib/otpBackgroundGate', () => ({ loadBackgroundCaptureAllowed: jest.fn() }));
jest.mock('./connectionStore', () => ({
  clearConnection: jest.fn(),
  loadConnection: jest.fn(),
  saveConnection: jest.fn(),
}));

const mockedUnlock = authenticateBiometric as jest.MockedFunction<typeof authenticateBiometric>;
const mockedAllowed = loadBackgroundCaptureAllowed as jest.MockedFunction<
  typeof loadBackgroundCaptureAllowed
>;
const mockedLoad = loadConnection as jest.MockedFunction<typeof loadConnection>;
const mockedSave = saveConnection as jest.MockedFunction<typeof saveConnection>;

const realFetch = globalThis.fetch;

const BASE_URL = 'https://importer.example.ts.net';
const ANSWER_MS = 15_000;
const SETTLE_MS = 60_000;
const TOKEN_TTL_MS = 15 * 60_000;

/** Where a slow reply stalls: before its headers, or after them while the body is read. */
type Stall = 'headers' | 'body';

/** Who renews in one step. */
type Who = 'screen' | 'background' | 'both';

/** One step: the clock moves on, then the portal answers each renewal this late. */
interface Step {
  readonly who: Who;
  readonly replyMs: number;
  readonly stall: Stall;
  readonly advanceMs: number;
}

const stepArb: fc.Arbitrary<Step> = fc.record({
  who: fc.constantFrom<Who>('screen', 'background', 'both'),
  replyMs: fc.constantFrom(
    0,
    5_000,
    ANSWER_MS - 1_000,
    ANSWER_MS + 1_000,
    30_000,
    SETTLE_MS - 1_000,
  ),
  stall: fc.constantFrom<Stall>('headers', 'body'),
  advanceMs: fc.integer({ min: 0, max: 2 * TOKEN_TTL_MS }),
});

/** What the portal replies with, before any delay is applied. */
interface Reply {
  readonly status: number;
  readonly body: unknown;
}

/**
 * A portal that rotates on receipt, like the real one, and records any replay.
 * @returns The fake `fetch`, a way to slow its replies, and what it observed.
 */
function portal() {
  let live = 'refresh-0';
  let issued = 0;
  let destroyed = false;
  let replyMs = 0;
  let stall: Stall = 'headers';
  const replays: string[] = [];

  const judge = (presented: string): Reply => {
    if (destroyed || presented !== live) {
      if (!destroyed) replays.push(presented);
      destroyed = true;
      return { status: 400, body: {} };
    }
    issued += 1;
    live = `refresh-${String(issued)}`;
    return {
      status: 200,
      body: { accessToken: `access-${String(issued)}`, refreshToken: live, expiresIn: 900 },
    };
  };

  const fakeFetch = (_url: string, init: RequestInit): Promise<Response> => {
    const sent = typeof init.body === 'string' ? init.body : '{}';
    const { refreshToken } = JSON.parse(sent) as { refreshToken: string };
    const reply = judge(refreshToken);
    const delay = replyMs;
    const later = <T>(value: T): Promise<T> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve(value);
        }, delay);
        init.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('Aborted'));
        });
      });
    const response = {
      ok: reply.status === 200,
      status: reply.status,
      json: () => (stall === 'body' ? later(reply.body) : Promise.resolve(reply.body)),
    } as unknown as Response;
    return stall === 'headers' ? later(response) : Promise.resolve(response);
  };

  return {
    fetch: fakeFetch,
    replays,
    live: () => live,
    answerWith: (ms: number, where: Stall) => {
      replyMs = ms;
      stall = where;
    },
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  mockedUnlock.mockResolvedValue({ status: 'success' });
  mockedAllowed.mockResolvedValue(true);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  jest.useRealTimers();
});

describe('a refresh answered after its caller stopped waiting (property)', () => {
  it('never replays a token, stores the live one, and answers a lone caller in time', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(stepArb, { minLength: 1, maxLength: 5 }), async (steps) => {
        const importer = portal();
        globalThis.fetch = importer.fetch as typeof fetch;
        const screenCopy: Connection = {
          baseUrl: BASE_URL,
          accessToken: 'access-0',
          refreshToken: 'refresh-0',
          expiresAt: 0,
        };
        let stored: Connection | null = screenCopy;
        mockedLoad.mockImplementation(() => Promise.resolve(stored));
        mockedSave.mockImplementation((next) => {
          stored = next;
          return Promise.resolve();
        });
        processLedger.forget();

        const run = async (step: Step): Promise<void> => {
          jest.setSystemTime(Date.now() + step.advanceMs);
          importer.answerWith(step.replyMs, step.stall);
          const started = Date.now();
          const waits: number[] = [];
          const timed = <T>(call: Promise<T>): Promise<void> =>
            call.then(
              () => {
                waits.push(Date.now() - started);
              },
              (error: unknown) => {
                expect(error).toEqual(new Error(NO_RESPONSE));
                waits.push(Date.now() - started);
              },
            );
          const calls: Promise<void>[] = [];
          if (step.who !== 'background') calls.push(timed(refreshConnection(screenCopy)));
          if (step.who !== 'screen') calls.push(timed(loadUnattendedSession()));
          await jest.advanceTimersByTimeAsync(2 * SETTLE_MS + 1_000);
          await Promise.all(calls);

          expect(importer.replays).toEqual([]);
          expect(stored?.refreshToken).toBe(importer.live());
          if (step.who !== 'both') expect(Math.max(...waits)).toBeLessThanOrEqual(ANSWER_MS);
        };

        await steps.reduce<Promise<void>>(
          (previous, step) => previous.then(async () => run(step)),
          Promise.resolve(),
        );
      }),
    );
  });
});
