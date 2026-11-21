/**
 * Accessible names for surfaces whose visible text is split across several
 * elements. A grouped pressable announces one name, so the name has to carry
 * the data the card displays rather than only the destination.
 */
import type { RunEntry } from '../api/status';

/** What the last-import card currently shows. */
interface LastImportLabelInput {
  /** Whether the card is still loading. */
  readonly loading: boolean;
  /** Whether the overview request failed, so the last run is unknown. */
  readonly unavailable: boolean;
  /** The visible summary, or null when no run exists. */
  readonly summary: string | null;
  /** The relative time under the summary, or null when no run exists. */
  readonly when: string | null;
}

/**
 * Builds the accessible name for the Home last-import card.
 * @param input - The card's state and visible data.
 * @returns A sentence carrying the summary, time, and destination.
 */
export function lastImportCardLabel(input: LastImportLabelInput): string {
  if (input.loading) {
    return 'Last import, loading.';
  }
  if (input.unavailable) {
    return 'Last import: unavailable. Open import status to try again.';
  }
  if (input.summary === null) {
    return 'Last import: no imports yet. Open import status.';
  }
  const when = input.when === null ? '' : `, ${input.when}`;
  return `Last import: ${input.summary}${when}. Open import status.`;
}

/** What the bank-count card currently shows. */
interface BankCountLabelInput {
  /** Whether the card is still loading. */
  readonly loading: boolean;
  /** How many banks are configured. */
  readonly count: number;
  /** Whether the overview request failed, so the count is unknown. */
  readonly unavailable: boolean;
}

/**
 * Builds the accessible name for the Home bank-count card.
 * @param input - The card's loading, count, and failure state.
 * @returns A sentence carrying the count, or the failure, and the destination.
 */
export function bankCountCardLabel(input: BankCountLabelInput): string {
  if (input.loading) {
    return 'Banks, loading.';
  }
  if (input.unavailable) {
    return 'Banks: count unavailable. Open bank settings.';
  }
  if (input.count === 0) {
    return 'Banks: none configured. Add your first bank.';
  }
  const noun = input.count === 1 ? 'bank' : 'banks';
  return `Banks: ${String(input.count)} ${noun} configured. Open bank settings.`;
}

/** One bank's outcome inside a run card. */
type RunBank = RunEntry['banks'][number];

/**
 * Describes a bank outcome in words, so the icon and colour are not the only
 * carriers of failure.
 * @param status - The status word the importer recorded.
 * @returns A phrase suitable for speech.
 */
function bankStatusLabel(status: string): string {
  if (status === 'success') {
    return 'import succeeded';
  }
  if (status === 'failure') {
    return 'import failed';
  }
  return 'import pending';
}

/**
 * Builds the accessible name for one per-bank row in a run card.
 * @param bank - The bank outcome.
 * @returns The bank name, outcome, and transaction count.
 */
export function bankRunRowLabel(bank: RunBank): string {
  const noun = bank.txns === 1 ? 'transaction' : 'transactions';
  return `${bank.name}: ${bankStatusLabel(bank.status)}, ${String(bank.txns)} ${noun}.`;
}

/**
 * Builds the accessible name for a run's status pill.
 * @param run - The run entry.
 * @returns The successful-bank count spelled out.
 */
export function runPillLabel(run: RunEntry): string {
  const noun = run.totalBanks === 1 ? 'bank' : 'banks';
  return `${String(run.successfulBanks)} of ${String(run.totalBanks)} ${noun} succeeded`;
}
