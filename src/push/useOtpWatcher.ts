/**
 * Watches for pending app-OTP requests while connected: polls the importer on
 * an interval and refreshes immediately when an OTP push arrives, surfacing the
 * next request the user should answer. Polling means a missed push still shows
 * the prompt. A dismissed request snoozes for a minute rather than disappearing
 * for the session, so an accidental dismissal is recoverable while the code is
 * still valid.
 */
import * as Notifications from 'expo-notifications';
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import type { Session } from '../api/importerClient';
import { getPendingOtp } from '../api/importerClient';
import type { PendingOtpRequest } from '../api/otp';
import { useAuth } from '../auth/AuthContext';
import { syncAutoReadWindow } from '../lib/otpAutoReadWindow';
import { refreshOtpChannel } from '../lib/otpChannelSync';
import { TASK_BUDGET_MS } from '../lib/otpDeadline';
import {
  keepThroughGap,
  pruneSnoozed,
  pruneUsed,
  selectPendingOtp,
  snoozeUntil,
} from '../lib/otpQueue';
import { drainHeldMessages } from '../lib/otpStashRunner';
import { withRequestTimeout } from '../lib/requestTimeout';

const POLL_INTERVAL_MS = 5000;
/** A hung poll must not latch the loop shut forever. */
const POLL_TIMEOUT_MS = POLL_INTERVAL_MS * 4;

/**
 * Builds the poll that reads the importer's outstanding requests.
 *
 * @param connection - The active session.
 * @param onRequests - Receives each successful read.
 * @returns A poll that reports failures to nobody, by design.
 */
function createPoll(
  connection: Session,
  onRequests: (requests: PendingOtpRequest[]) => void,
): () => Promise<void> {
  return async () => {
    try {
      onRequests(await getPendingOtp(connection));
    } catch {
      // Silent on purpose: this runs every few seconds, so reporting a failed
      // poll would replace one message with an identical one indefinitely.
      // The screens that need the importer report their own failures.
    }
  };
}

/**
 * Reacts to one successful read of the importer's outstanding requests.
 *
 * @param requests - Everything the importer currently wants a code for.
 */
function handleRequests(requests: PendingOtpRequest[]): void {
  // Tracks every pending request, not just the one shown: the native receiver
  // has to stay open as long as any code could still arrive.
  void syncAutoReadWindow(requests);
  if (requests.length > 0) {
    // A code that arrived before the importer asked for it is being held
    // natively; this is the moment it becomes answerable. Nothing is holding
    // the process open on a timer here, so the drain's own cap is the limit.
    void drainHeldMessages(() => TASK_BUDGET_MS);
  }
}

/**
 * Reconciles the OTP channel once when a poll loop starts.
 *
 * The channel can be changed from the importer's own UI, and off the app
 * channel the switches that would close capture are hidden, so this is the
 * only thing that reconciles it.
 * @param getConnection - Reads the current session.
 */
function refreshChannelOnce(getConnection: () => Session | null): void {
  const first = getConnection();
  if (first) {
    void refreshOtpChannel(first);
  }
}

/**
 * Runs one poll against the importer.
 * @param connection - The session to read with.
 * @param onRequests - Receives a successful snapshot.
 * @returns A promise that settles when the request does.
 */
function runPoll(
  connection: Session,
  onRequests: (requests: PendingOtpRequest[]) => void,
): Promise<void> {
  return createPoll(connection, onRequests)();
}

/**
 * Starts the serialized poll loop for one importer.
 *
 * One poll at a time: an older empty snapshot must not prune a snooze the newer
 * one created. A response that arrives after its poll timed out is ignored, so
 * a stuck transport cannot latch the loop shut or overwrite a newer snapshot.
 * The session is read for every poll rather than captured once, because a
 * silent token refresh replaces it without changing the base URL.
 * @param getConnection - Reads the current session, or null when signed out.
 * @param onRequests - Receives each successful read.
 * @returns A cleanup that stops the loop and closes SMS capture.
 */
function startOtpPolling(
  getConnection: () => Session | null,
  onRequests: (requests: PendingOtpRequest[]) => void,
): () => void {
  let active = true;
  let pollToken = 0;
  refreshChannelOnce(getConnection);
  let polling = false;
  const poll = async (): Promise<void> => {
    const connection = polling ? null : getConnection();
    if (!connection) {
      return;
    }
    polling = true;
    const token = ++pollToken;
    const work = runPoll(connection, (requests) => {
      if (active && token === pollToken) onRequests(requests);
    });
    try {
      await withRequestTimeout(work, POLL_TIMEOUT_MS);
    } catch {
      // Invalidate this poll's token so a late snapshot cannot be applied.
      // The gate is still released: a transport that ignores its abort must
      // not lock the loop shut for the rest of the session.
      if (token === pollToken) {
        pollToken += 1;
      }
    } finally {
      polling = false;
    }
  };
  void poll();
  const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
  const sub = Notifications.addNotificationReceivedListener(() => void poll());
  return () => {
    active = false;
    clearInterval(interval);
    sub.remove();
    // Leaving the window open past the screen that opened it would let the
    // receiver examine messages for a scrape nobody is watching any more.
    void syncAutoReadWindow([]);
  };
}

/** The request queue's state plus the callback that applies each poll. */
interface OtpQueue {
  pending: PendingOtpRequest | null;
  pendingRef: RefObject<PendingOtpRequest | null>;
  snoozedUntil: RefObject<Map<string, number>>;
  setPending: Dispatch<SetStateAction<PendingOtpRequest | null>>;
  autoSubmitted: ReadonlyMap<string, number>;
  applyRequests: (requests: PendingOtpRequest[]) => void;
  markAutoSubmitted: (id: string, deadline: number) => void;
}

/** What the prompt needs from the watcher. */
interface OtpWatcher {
  pending: PendingOtpRequest | null;
  dismiss: (requestId?: string, deadline?: number) => void;
  clearAnswered: (requestId: string, deadline: number) => void;
  autoSubmitted: ReadonlyMap<string, number>;
  markAutoSubmitted: (id: string, deadline: number) => void;
}

/** The refs and setters one poll updates. */
interface SnapshotTargets {
  readonly pendingRef: RefObject<PendingOtpRequest | null>;
  readonly snoozedUntil: RefObject<Map<string, number>>;
  readonly missingPolls: RefObject<number>;
  readonly setAutoSubmitted: Dispatch<SetStateAction<ReadonlyMap<string, number>>>;
  readonly setPending: Dispatch<SetStateAction<PendingOtpRequest | null>>;
}

/**
 * Applies one successful poll to the queue.
 * @param requests - The importer's pending requests.
 * @param targets - The queue refs and setters.
 */
function applySnapshot(requests: PendingOtpRequest[], targets: SnapshotTargets): void {
  const { pendingRef, snoozedUntil, missingPolls, setAutoSubmitted, setPending } = targets;
  const current = pendingRef.current;
  const next = selectPendingOtp(requests, snoozedUntil.current);
  const keep = keepThroughGap({
    current,
    requests,
    next,
    misses: missingPolls.current,
  });
  // Keep SMS capture open for the request shown through a transient gap.
  handleRequests(keep && current ? [...requests, current] : requests);
  snoozedUntil.current = pruneSnoozed(snoozedUntil.current);
  setAutoSubmitted((markers) => {
    const pruned = pruneUsed(markers);
    return pruned.size === markers.size ? markers : pruned;
  });
  if (keep) {
    missingPolls.current += 1;
    return;
  }
  missingPolls.current = 0;
  pendingRef.current = next;
  setPending(next);
}

/**
 * Owns the pending request, its snoozes, and the one-shot auto-submit markers.
 * @returns The queue state and the poll applier.
 */
function useOtpQueue(): OtpQueue {
  const [pending, setPending] = useState<PendingOtpRequest | null>(null);
  const [autoSubmitted, setAutoSubmitted] = useState<ReadonlyMap<string, number>>(new Map());
  const pendingRef = useRef<PendingOtpRequest | null>(null);
  const snoozedUntil = useRef<Map<string, number>>(new Map());
  const missingPolls = useRef(0);

  const applyRequests = useCallback((requests: PendingOtpRequest[]) => {
    applySnapshot(requests, {
      pendingRef,
      snoozedUntil,
      missingPolls,
      setAutoSubmitted,
      setPending,
    });
  }, []);

  const markAutoSubmitted = useCallback((id: string, deadline: number) => {
    setAutoSubmitted((current) => {
      if (current.has(id)) {
        return current;
      }
      return new Map(current).set(id, deadline);
    });
  }, []);

  return {
    pending,
    pendingRef,
    snoozedUntil,
    setPending,
    autoSubmitted,
    applyRequests,
    markAutoSubmitted,
  };
}

/**
 * Keeps the poll loop tied to the importer, not to a session object that is
 * replaced on every silent token refresh.
 * @param connection - The active session, or null when signed out.
 * @param applyRequests - Applies one successful poll.
 */
function useOtpPolling(
  connection: Session | null,
  applyRequests: (requests: PendingOtpRequest[]) => void,
): void {
  const connectionRef = useRef(connection);

  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);

  useEffect(() => {
    const activeConnection = connectionRef.current;
    if (!activeConnection) {
      applyRequests([]);
      return undefined;
    }
    return startOtpPolling(() => connectionRef.current, applyRequests);
  }, [applyRequests, connection?.baseUrl]);
}

/**
 * Builds the two ways the visible request can leave: dismiss, or answer.
 * @param pendingRef - The request shown now.
 * @param snoozedUntil - Per-request snooze deadlines.
 * @param setPending - Shows or clears the prompt.
 * @returns The dismiss and answer callbacks.
 */
function useOtpDismissals(
  pendingRef: RefObject<PendingOtpRequest | null>,
  snoozedUntil: RefObject<Map<string, number>>,
  setPending: Dispatch<SetStateAction<PendingOtpRequest | null>>,
): Pick<OtpWatcher, 'dismiss' | 'clearAnswered'> {
  const dismiss = useCallback(
    (requestId?: string, deadline?: number) => {
      const current = pendingRef.current;
      const id = requestId ?? current?.id;
      const requestDeadline = deadline ?? current?.deadline;
      if (id === undefined || requestDeadline === undefined) {
        return;
      }
      // Record the snooze for the named request even if a newer one is on
      // screen: a late dismissal must not be lost, and it must not hide B.
      snoozedUntil.current.set(id, snoozeUntil(requestDeadline));
      if (current?.id === id) {
        pendingRef.current = null;
        setPending(null);
      }
    },
    [pendingRef, setPending, snoozedUntil],
  );

  const clearAnswered = useCallback(
    (requestId: string, deadline: number) => {
      // Suppress until the request itself ends: a fixed quiet period can expire
      // while a lagging importer still lists it, which re-prompts the answer.
      snoozedUntil.current.set(requestId, deadline);
      if (pendingRef.current?.id === requestId) {
        pendingRef.current = null;
        setPending(null);
      }
    },
    [pendingRef, setPending, snoozedUntil],
  );

  return { dismiss, clearAnswered };
}

/**
 * Provides the next pending OTP request, its dismiss/answer callbacks, and the
 * per-request markers that keep automatic submission single-shot.
 * @returns The pending request, callbacks, and markers.
 */
export function useOtpWatcher(): OtpWatcher {
  const { connection } = useAuth();
  const queue = useOtpQueue();
  useOtpPolling(connection, queue.applyRequests);
  const { dismiss, clearAnswered } = useOtpDismissals(
    queue.pendingRef,
    queue.snoozedUntil,
    queue.setPending,
  );
  return {
    pending: queue.pending,
    dismiss,
    clearAnswered,
    autoSubmitted: queue.autoSubmitted,
    markAutoSubmitted: queue.markAutoSubmitted,
  };
}
