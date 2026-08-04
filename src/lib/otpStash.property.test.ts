/**
 * Property-based tests for the held-message stash.
 *
 * The examples beside this file cover the orderings we thought of. These cover
 * the ones we did not. The stash is filled from messages an attacker can send
 * at will, so the selector must be total, and anything it hands back must
 * satisfy every rule that makes an unattended submission safe.
 */
import * as fc from 'fast-check';

import { extractOtpCode } from './otpMessage';
import {
  liveStashEntries,
  selectStashedCode,
  STASH_SPENT,
  STASH_TTL_MS,
  type StashedMessage,
} from './otpStash';

const NOW = 1_785_265_164_486;
const REQUEST_ID = 'req-1';

const messageArb: fc.Arbitrary<StashedMessage> = fc.record({
  id: fc.string({ minLength: 1 }),
  body: fc.oneof(fc.string(), fc.stringMatching(/^[ A-Za-z]{0,20}\d{4,8}[ A-Za-z]{0,20}$/)),
  sender: fc.string(),
  receivedAt: fc.integer({ min: NOW - 2 * STASH_TTL_MS, max: NOW }),
  attempted: fc.array(fc.constantFrom(REQUEST_ID, 'req-other', STASH_SPENT), { maxLength: 3 }),
});

const stashArb = fc.array(messageArb, { maxLength: 6 });

describe('selectStashedCode properties', () => {
  it('is total: no stash makes it throw', () => {
    fc.assert(
      fc.property(stashArb, (entries) => {
        expect(() => selectStashedCode(entries, REQUEST_ID, NOW)).not.toThrow();
      }),
    );
  });

  it('only ever returns a message that was in the stash', () => {
    fc.assert(
      fc.property(stashArb, (entries) => {
        const found = selectStashedCode(entries, REQUEST_ID, NOW);
        if (found !== null) {
          expect(entries).toContain(found.entry);
        }
      }),
    );
  });

  it('returns exactly the code its own message parses to', () => {
    fc.assert(
      fc.property(stashArb, (entries) => {
        const found = selectStashedCode(entries, REQUEST_ID, NOW);
        if (found !== null) {
          expect(extractOtpCode(found.entry.body)).toBe(found.code);
        }
      }),
    );
  });

  it('never returns a message already attempted against this request', () => {
    fc.assert(
      fc.property(stashArb, (entries) => {
        const found = selectStashedCode(entries, REQUEST_ID, NOW);
        if (found !== null) {
          expect(found.entry.attempted).not.toContain(REQUEST_ID);
        }
      }),
    );
  });

  // The one marker that outlives the request it was written for: a code the
  // importer accepted is spent for everybody, whichever request is asking.
  it('never returns a message whose code has already been spent', () => {
    fc.assert(
      fc.property(stashArb, (entries) => {
        const found = selectStashedCode(entries, REQUEST_ID, NOW);
        if (found !== null) {
          expect(found.entry.attempted).not.toContain(STASH_SPENT);
        }
      }),
    );
  });

  it('never returns a message that has aged out', () => {
    fc.assert(
      fc.property(stashArb, (entries) => {
        const found = selectStashedCode(entries, REQUEST_ID, NOW);
        if (found !== null) {
          expect(NOW - found.entry.receivedAt).toBeLessThan(STASH_TTL_MS);
        }
      }),
    );
  });

  it('never invents a code the stash does not literally contain', () => {
    fc.assert(
      fc.property(stashArb, (entries) => {
        const found = selectStashedCode(entries, REQUEST_ID, NOW);
        if (found !== null) {
          expect(found.entry.body).toContain(found.code);
        }
      }),
    );
  });
});

describe('liveStashEntries properties', () => {
  it('only ever removes entries', () => {
    fc.assert(
      fc.property(stashArb, (entries) => {
        const live = liveStashEntries(entries, NOW);
        expect(live.length).toBeLessThanOrEqual(entries.length);
        expect(live.every((entry) => entries.includes(entry))).toBe(true);
      }),
    );
  });

  it('is idempotent: filtering twice changes nothing', () => {
    fc.assert(
      fc.property(stashArb, (entries) => {
        const once = liveStashEntries(entries, NOW);
        expect(liveStashEntries(once, NOW)).toEqual(once);
      }),
    );
  });
});
