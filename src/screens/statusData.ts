/**
 * Loads the importer's recent runs for the status screen.
 *
 * The effect is keyed on the importer address rather than the session object:
 * a silent token refresh replaces that object every few minutes, and refetching
 * there would flash the skeleton and could overwrite a newer pull-to-refresh.
 */
import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useState } from 'react';

import { getStatus, type Session } from '../api/importerClient';
import type { RunEntry } from '../api/status';
import { failureMessage, reportedOrFallback } from '../lib/errorMessages';
import { useLatestRef } from '../lib/useLatestRef';

const UNREACHABLE = failureMessage('unreachable').text;

/** The run list and load state the screen renders. */
export interface StatusData {
  /** The runs, newest first. */
  readonly runs: RunEntry[];
  /** Why the initial load failed, or null. */
  readonly error: string | null;
  /** Whether the first load is still outstanding. */
  readonly loading: boolean;
  /** Replaces the loaded runs. */
  readonly setRuns: Dispatch<SetStateAction<RunEntry[]>>;
  /** Clears or reports a load error. */
  readonly setError: (error: string | null) => void;
  /** Tries the initial load again. */
  readonly reload: () => void;
}

/**
 * Loads the runs once per importer and exposes a retry.
 * @param connection - The active session, or null when signed out.
 * @returns The runs, load state, and retry.
 */
export function useStatusData(connection: Session | null): StatusData {
  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const connectionRef = useLatestRef(connection);

  useEffect(() => {
    const activeConnection = connectionRef.current;
    if (!activeConnection) {
      return undefined;
    }
    let active = true;
    const run = async (): Promise<void> => {
      try {
        const loaded = await getStatus(activeConnection);
        if (active) {
          setRuns(loaded);
        }
      } catch (e) {
        if (active) {
          setError(reportedOrFallback(e instanceof Error ? e.message : undefined, UNREACHABLE));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [connection?.baseUrl, connectionRef, reloadKey]);

  const reload = (): void => {
    setError(null);
    setLoading(true);
    setReloadKey((key) => key + 1);
  };

  return { runs, error, loading, setRuns, setError, reload };
}
