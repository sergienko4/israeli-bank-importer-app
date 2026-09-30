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
 * Runs work that reads, spends, and replaces the stored refresh token.
 *
 * Work queues behind whatever is already running, and a failure is handed to
 * its own caller without blocking the queue for the next one. Nothing that
 * waits on a person belongs inside — a biometric prompt goes before this, not
 * within it — because every renewal in the process waits behind the holder.
 * @param work - The read-refresh-save sequence to run alone.
 * @returns Whatever the work returns.
 */
export function withRefreshLock<T>(work: () => Promise<T>): Promise<T> {
  const run = tail.then(work);
  tail = run.catch(() => undefined);
  return run;
}
