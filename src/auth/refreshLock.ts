/**
 * Serialises every spend of the refresh token in this process.
 *
 * The portal accepts each refresh token exactly once: a second presentation
 * reads as a stolen copy, and it ends the whole session rather than guess which
 * holder is genuine. Both the screen and the background capture renew, from the
 * same JavaScript runtime, so two renewals that overlapped would each read the
 * same stored token, present it twice, and sign the user out.
 *
 * Holding this while reading the stored pair, refreshing, and saving the result
 * makes each renewal start from whatever the previous one saved.
 */

let tail: Promise<unknown> = Promise.resolve();

/**
 * Keeps the lock held until `pending` settles, even after the work returned.
 *
 * For a refresh whose caller stopped waiting: its reply may still arrive with
 * the only live token, and the next renewal has to start from it.
 */
export type HoldLock = (pending: Promise<unknown>) => void;

/**
 * Runs work that reads, spends, and replaces the stored refresh token.
 *
 * Work queues behind whatever is already running, and a failure is handed to
 * its own caller without blocking the queue for the next one. Nothing that
 * waits on a person belongs inside — a biometric prompt goes before this, not
 * within it — because every renewal in the process waits behind the holder.
 *
 * The work may answer its caller before everything it started has settled, by
 * handing the rest to `hold` before it returns; the next work then waits for
 * that too.
 * @param work - The read-refresh-save sequence to run alone.
 * @returns Whatever the work returns.
 */
export function withRefreshLock<T>(work: (hold: HoldLock) => Promise<T>): Promise<T> {
  const held: Promise<unknown>[] = [];
  const run = tail.then(async () =>
    work((pending) => {
      held.push(pending);
    }),
  );
  tail = run.catch(() => undefined).then(async () => Promise.allSettled(held));
  return run;
}

/**
 * Waits until nothing holds the lock, including work queued while waiting.
 *
 * For a caller about to stop keeping the process alive: a renewal still in
 * flight holds the only live refresh token until its reply is saved.
 * @returns A promise resolving once the lock is free; it never rejects.
 */
export async function refreshSettled(): Promise<void> {
  const seen = tail;
  await seen;
  if (seen !== tail) await refreshSettled();
}
