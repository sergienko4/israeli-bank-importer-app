/**
 * Shared tone for an import run's status pill.
 *
 * A run with no banks is neither a success nor a failure; without the guard,
 * `0 >= 0` reported an empty run in the success colour.
 */

/** The semantic tone an import run's pill uses. */
export type RunTone = 'success' | 'danger' | 'warning' | 'neutral';

/**
 * Picks the tone for one import run.
 * @param totalBanks - How many banks the run attempted.
 * @param successfulBanks - How many of them succeeded.
 * @returns The pill tone.
 */
export function runTone(totalBanks: number, successfulBanks: number): RunTone {
  if (totalBanks <= 0) {
    return 'neutral';
  }
  if (successfulBanks >= totalBanks) {
    return 'success';
  }
  return successfulBanks === 0 ? 'danger' : 'warning';
}
