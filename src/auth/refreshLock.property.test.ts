/**
 * Property-based tests for the refresh lock.
 *
 * A refresh token is single-use, so for any mix of renewals queued at once —
 * slow or fast, succeeding or failing — no two may run together, they must run
 * in the order they were asked for, and each caller must get back its own
 * outcome, never a neighbour's result or a stale failure.
 */
import * as fc from 'fast-check';

import { withRefreshLock } from './refreshLock';

/** One queued renewal: how many turns it yields before settling, and whether it throws. */
interface Job {
  readonly yields: number;
  readonly fails: boolean;
}

const jobArb: fc.Arbitrary<Job> = fc.record({
  yields: fc.integer({ min: 0, max: 5 }),
  fails: fc.boolean(),
});

/**
 * Lets other queued work run, so an unserialised job would visibly overlap.
 * @param turns - How many microtask turns to give away.
 * @returns A promise that settles after those turns.
 */
function yieldTurns(turns: number): Promise<void> {
  return Array.from({ length: turns }).reduce<Promise<void>>(
    (chain) => chain.then(() => undefined),
    Promise.resolve(),
  );
}

describe('withRefreshLock (property)', () => {
  it('runs every job alone, in call order, and settles each with its own outcome', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(jobArb, { minLength: 1, maxLength: 12 }), async (jobs) => {
        let active = 0;
        let maxActive = 0;
        const started: number[] = [];
        const runs = jobs.map((job, index) =>
          withRefreshLock(async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            started.push(index);
            await yieldTurns(job.yields);
            active -= 1;
            if (job.fails) throw new Error(`renewal ${String(index)} refused`);
            return index;
          }),
        );

        const outcomes = await Promise.allSettled(runs);

        expect(maxActive).toBe(1);
        expect(started).toEqual(jobs.map((_, index) => index));
        jobs.forEach((job, index) => {
          const outcome = outcomes[index];
          if (job.fails) {
            expect(outcome).toEqual({
              status: 'rejected',
              reason: new Error(`renewal ${String(index)} refused`),
            });
          } else {
            expect(outcome).toEqual({ status: 'fulfilled', value: index });
          }
        });
      }),
    );
  });
});
