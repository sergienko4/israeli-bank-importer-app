/**
 * Pure helpers that derive the Home dashboard's at-a-glance summary from the
 * importer's config and status responses. Kept free of React and I/O so the
 * summary logic is unit-testable and the screen stays declarative.
 */
import type { ConfigObject } from '../api/manifest';
import type { RunEntry } from '../api/status';

/**
 * Counts the banks configured in a config object.
 * @param config - The importer config.
 * @returns The number of configured banks (0 when absent).
 */
export function banksConfigured(config: ConfigObject): number {
  const banks = config.banks;
  return typeof banks === 'object' && banks !== null ? Object.keys(banks).length : 0;
}

/**
 * Returns the most recent run from a status list. The importer returns runs
 * oldest-first, so the latest is the last element.
 * @param runs - The runs from GET /api/status.
 * @returns The latest run, or null when there are none.
 */
export function latestRun(runs: RunEntry[]): RunEntry | null {
  return runs.length > 0 ? runs[runs.length - 1] : null;
}

/**
 * Formats an ISO timestamp as a short relative time (e.g. "5m ago"), falling
 * back to a locale date for anything a week or older.
 * @param iso - The ISO timestamp.
 * @param now - The reference time in epoch ms (defaults to Date.now()).
 * @returns A compact human-readable string.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return iso;
  }
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) {
    return 'just now';
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${String(minutes)}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${String(hours)}h ago`;
  }
  const days = Math.round(hours / 24);
  if (days < 7) {
    return `${String(days)}d ago`;
  }
  return new Date(then).toLocaleDateString();
}
