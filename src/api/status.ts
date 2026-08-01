/** Types for the importer's redacted import-run status (GET /api/status). */

/** Per-bank outcome within a run. */
export interface RunBank {
  name: string;
  status: string;
  duration?: number;
  txns: number;
  error?: string;
}

/** A single completed import run summary. */
export interface RunEntry {
  timestamp: string;
  totalBanks: number;
  successfulBanks: number;
  failedBanks: number;
  totalTransactions: number;
  totalDuration: number;
  /** Percentage of banks that succeeded, already out of 100. */
  successRate: number;
  banks: RunBank[];
}
