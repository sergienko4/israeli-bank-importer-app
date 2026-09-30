/**
 * Property-based tests for the unattended session loader.
 *
 * The portal accepts each refresh token once and ends the whole session on a
 * second presentation, and a closed app renews with nobody there to sign in
 * again. So for any run of captures — clocks jumping ahead, retries that
 * overlap, saves that fail — the loader must never present a spent token, must
 * never hand back an expired one, and must never leave a renewed access token
 * in storage that the screen could send without an unlock. And while the user
 * has capture switched off it must not spend a token at all.
 */
import * as fc from 'fast-check';

import type { AppTokens } from '../api/appTokens';
import type { Connection } from '../auth/connectionStore';
import { createTokenLedger } from '../auth/tokenLedger';
import { createUnattendedSession, SAVED_EXPIRED, WITHHELD_ACCESS } from './otpBackgroundSession';

const START = 1_700_000_000_000;
const BASE_URL = 'https://importer.example.ts.net';
const TOKEN_TTL = 15 * 60_000;

/** One capture: the clock moves on, then this many loads run at once. */
interface Step {
  readonly advanceMs: number;
  readonly overlapping: number;
  readonly saveFails: boolean;
  readonly switchedOn: boolean;
}

const stepArb: fc.Arbitrary<Step> = fc.record({
  advanceMs: fc.integer({ min: 0, max: 2 * TOKEN_TTL }),
  overlapping: fc.integer({ min: 1, max: 3 }),
  saveFails: fc.boolean(),
  switchedOn: fc.boolean(),
});

/** How long the stored access token has left when the first capture starts. */
const initialLifeArb = fc.integer({ min: -TOKEN_TTL, max: TOKEN_TTL });

/**
 * A portal that rotates like the real one, and an oracle that records misuse.
 * @param now - The shared clock.
 * @returns The portal's refresh call, and what it observed.
 */
function portal(now: () => number) {
  let live = 'refresh-0';
  let issued = 0;
  const replays: string[] = [];
  const accessExpiry = new Map<string, number>();
  const refresh = (_baseUrl: string, refreshToken: string): Promise<AppTokens> => {
    if (refreshToken !== live) {
      replays.push(refreshToken);
      return Promise.reject(new Error('Session ended.'));
    }
    issued += 1;
    live = `refresh-${String(issued)}`;
    const tokens = {
      accessToken: `access-${String(issued)}`,
      refreshToken: live,
      expiresAt: now() + TOKEN_TTL,
    };
    accessExpiry.set(tokens.accessToken, tokens.expiresAt);
    return Promise.resolve(tokens);
  };
  return { refresh, replays, accessExpiry, issuedCount: () => issued };
}

describe('createUnattendedSession (property)', () => {
  it('never replays a refresh token, returns a live token, and stores renewals withheld', async () => {
    await fc.assert(
      fc.asyncProperty(initialLifeArb, fc.array(stepArb, { maxLength: 8 }), async (life, steps) => {
        let clock = START;
        const now = (): number => clock;
        const importer = portal(now);
        importer.accessExpiry.set('access-0', START + life);
        let stored: Connection = {
          baseUrl: BASE_URL,
          accessToken: 'access-0',
          refreshToken: 'refresh-0',
          expiresAt: START + life,
        };
        let saveFails = false;
        let switchedOn = true;
        const loader = createUnattendedSession({
          allowed: () => Promise.resolve(switchedOn),
          load: () => Promise.resolve(stored),
          save: (next) => {
            if (saveFails) return Promise.reject(new Error('Keystore unavailable.'));
            stored = next;
            return Promise.resolve();
          },
          refresh: importer.refresh,
          now,
          ledger: createTokenLedger(),
        });

        const capture = async (step: Step): Promise<void> => {
          clock += step.advanceMs;
          saveFails = step.saveFails;
          switchedOn = step.switchedOn;
          const issuedBefore = importer.issuedCount();
          const sessions = await Promise.all(
            Array.from({ length: step.overlapping }, async () => loader()),
          );

          expect(importer.replays).toEqual([]);
          if (!step.switchedOn) {
            expect(importer.issuedCount()).toBe(issuedBefore);
            expect(sessions.every((session) => session === null)).toBe(true);
            return;
          }
          expect(importer.issuedCount() - issuedBefore).toBeLessThanOrEqual(1);
          for (const session of sessions) {
            expect(session?.baseUrl).toBe(BASE_URL);
            const expiry = importer.accessExpiry.get(session?.token ?? '') ?? 0;
            expect(expiry).toBeGreaterThan(clock);
          }
          if (stored.refreshToken !== 'refresh-0') {
            expect(stored.accessToken).toBe(WITHHELD_ACCESS);
            expect(stored.expiresAt).toBe(SAVED_EXPIRED);
          }
        };

        await steps.reduce<Promise<void>>(
          (previous, step) => previous.then(async () => capture(step)),
          Promise.resolve(),
        );
      }),
    );
  });
});
