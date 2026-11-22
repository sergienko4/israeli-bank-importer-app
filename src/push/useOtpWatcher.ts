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

import { getPendingOtp, type Session } from '../api/importerClient';
import type { PendingOtpRequest } from '../api/otp';
import { useAuth } from '../auth/AuthContext';
import { syncAutoReadWindow } from '../lib/otpAutoReadWindow';
import { TASK_BUDGET_MS } from '../lib/otpDeadline';
import {
  keepThroughGap,
  pruneSnoozed,
  pruneUsed,
  selectNextOtp,
  snoozeUntil,
} from '../lib/otpQueue';
import { drainHeldMessages } from '../lib/otpStashRunner';
import { withRequestTimeout } from '../lib/requestTimeout';
import { createChannelRefresh } from './otpChannelRefresh';

const POLL_INTERVAL_MS = 5000;
/** A hung poll must not latch the loop shut forever. */
const POLL_TIMEOUT_MS = POLL_INTERVAL_MS * 4;

/** A pending request plus the pairing that owned the session which fetched it. */
export type OwnedPendingOtpRequest = PendingOtpRequest & {
  /** The pairing the polling connection was authenticated under. */
  readonly pairing: number;
};

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
 * @param pairing - The pairing that owns the polling connection.
 * @param onRequests - Receives each successful read with its pairing.
 * @returns A cleanup that stops the loop and closes SMS capture.
 */
function startOtpPolling(
  getConnection: () => Session | null,
  pairing: number,
  onRequests: (requests: PendingOtpRequest[], pairing: number) => void,
): () => void {
  const state = { active: true, pollToken: 0, polling: false };
  const refreshChannel = createChannelRefresh(getConnection, () => state.active);
  refreshChannel();
  const poll = async (): Promise<void> => {
    const connection = state.polling ? null : getConnection();
    if (!connection) {
      return;
    }
    refreshChannel();
    state.polling = true;
    const token = ++state.pollToken;
    const work = runPoll(connection, (requests) => {
      if (state.active && token === state.pollToken) onRequests(requests, pairing);
    });
    try {
      await withRequestTimeout(work, POLL_TIMEOUT_MS);
    } catch {
      // Invalidate this poll's token so a late snapshot cannot be applied.
      // The gate is still released: a transport that ignores its abort must
      // not lock the loop shut for the rest of the session.
      if (token === state.pollToken) {
        state.pollToken += 1;
      }
    } finally {
      state.polling = false;
    }
  };
  void poll();
  const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
  const sub = Notifications.addNotificationReceivedListener(() => void poll());
  return () => {
    state.active = false;
    clearInterval(interval);
    sub.remove();
    // Leaving the window open past the screen that opened it would let the
    // receiver examine messages for a scrape nobody is watching any more.
    void syncAutoReadWindow([]);
  };
}

/** The request queue's state plus the callback that applies each poll. */
interface OtpQueue {
  pending: OwnedPendingOtpRequest | null;
  pendingRef: RefObject<OwnedPendingOtpRequest | null>;
  snoozedUntil: RefObject<Map<string, number>>;
  setPending: Dispatch<SetStateAction<OwnedPendingOtpRequest | null>>;
  autoSubmitted: ReadonlyMap<string, number>;
  applyRequests: (requests: PendingOtpRequest[], pairing: number) => void;
  markAutoSubmitted: (id: string, deadline: number) => void;
  reset: () => void;
}

/** What the prompt needs from the watcher. */
interface OtpWatcher {
  pending: OwnedPendingOtpRequest | null;
  dismiss: (requestId: string, deadline: number, pairing: number) => void;
  clearAnswered: (requestId: string, deadline: number, pairing: number) => void;
  autoSubmitted: ReadonlyMap<string, number>;
  markAutoSubmitted: (id: string, deadline: number) => void;
}

/** The refs and setters one poll updates. */
interface SnapshotTargets {
  readonly pendingRef: RefObject<OwnedPendingOtpRequest | null>;
  readonly snoozedUntil: RefObject<Map<string, number>>;
  readonly missingPolls: RefObject<number>;
  readonly setAutoSubmitted: Dispatch<SetStateAction<ReadonlyMap<string, number>>>;
  readonly setPending: Dispatch<SetStateAction<OwnedPendingOtpRequest | null>>;
}

/**
 * Applies one successful poll to the queue.
 * @param requests - The importer's pending requests.
 * @param pairing - The pairing that owns the polling connection.
 * @param targets - The queue refs and setters.
 */
function applySnapshot(
  requests: PendingOtpRequest[],
  pairing: number,
  targets: SnapshotTargets,
): void {
  const { pendingRef, snoozedUntil, missingPolls, setAutoSubmitted, setPending } = targets;
  const current = pendingRef.current;
  const next = selectNextOtp({
    current,
    requests,
    snoozedUntil: snoozedUntil.current,
  });
  const keep = keepThroughGap({
    current,
    requests,
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
  const owned = next === null ? null : { ...next, pairing };
  pendingRef.current = owned;
  setPending(owned);
}

/**
 * Builds the one-shot marker writer.
 * @param set - The marker state setter.
 * @returns A callback that records a marker once.
 */
function useAutoSubmitMarker(
  set: Dispatch<SetStateAction<ReadonlyMap<string, number>>>,
): (id: string, deadline: number) => void {
  return useCallback(
    (id: string, deadline: number) => {
      set((current) => {
        if (current.has(id)) {
          return current;
        }
        return new Map(current).set(id, deadline);
      });
    },
    [set],
  );
}

/**
 * Owns the pending request, its snoozes, and the one-shot auto-submit markers.
 * @returns The queue state and the poll applier.
 */
function useOtpQueue(): OtpQueue {
  const [pending, setPending] = useState<OwnedPendingOtpRequest | null>(null);
  const [autoSubmitted, setAutoSubmitted] = useState<ReadonlyMap<string, number>>(new Map());
  const pendingRef = useRef<OwnedPendingOtpRequest | null>(null);
  const snoozedUntil = useRef<Map<string, number>>(new Map());
  const missingPolls = useRef(0);

  const applyRequests = useCallback((requests: PendingOtpRequest[], pairing: number) => {
    applySnapshot(requests, pairing, {
      pendingRef,
      snoozedUntil,
      missingPolls,
      setAutoSubmitted,
      setPending,
    });
  }, []);

  const markAutoSubmitted = useAutoSubmitMarker(setAutoSubmitted);

  const reset = useCallback(() => {
    pendingRef.current = null;
    snoozedUntil.current = new Map();
    missingPolls.current = 0;
    setPending(null);
    setAutoSubmitted(new Map());
  }, []);

  return {
    pending,
    pendingRef,
    snoozedUntil,
    setPending,
    autoSubmitted,
    applyRequests,
    markAutoSubmitted,
    reset,
  };
}

/** What the poll loop needs to stay tied to one importer and pairing. */
interface OtpPolling {
  /** The active session, or null when signed out. */
  readonly connection: Session | null;
  /** The pairing that owns the session. */
  readonly pairing: number;
  /** Applies one successful poll with its pairing. */
  readonly applyRequests: (requests: PendingOtpRequest[], pairing: number) => void;
  /** Clears the previous importer's queue before the first poll. */
  readonly reset: () => void;
}

/**
 * Keeps the poll loop tied to the importer, not to a session object that is
 * replaced on every silent token refresh.
 * @param polling - The connection, pairing, poll applier and reset.
 */
function useOtpPolling({ connection, pairing, applyRequests, reset }: OtpPolling): void {
  const connectionRef = useRef(connection);

  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);

  useEffect(() => {
    reset();
    const activeConnection = connectionRef.current;
    if (!activeConnection) {
      applyRequests([], pairing);
      return undefined;
    }
    return startOtpPolling(() => connectionRef.current, pairing, applyRequests);
  }, [applyRequests, connection?.baseUrl, pairing, reset]);
}

/** What the dismissal callbacks need from the queue. */
interface DismissalQueue {
  /** The request shown now. */
  readonly pendingRef: RefObject<OwnedPendingOtpRequest | null>;
  /** Per-request snooze deadlines. */
  readonly snoozedUntil: RefObject<Map<string, number>>;
  /** Shows or clears the prompt. */
  readonly setPending: Dispatch<SetStateAction<OwnedPendingOtpRequest | null>>;
  /** The pairing that owns the current queue. */
  readonly pairing: number;
}

/**
 * Keeps the pairing that currently owns the queue.
 * @param pairing - The pairing the watcher renders with.
 * @returns A ref that always names the live owner.
 */
function useQueueOwner(pairing: number): RefObject<number> {
  const owner = useRef(pairing);
  useEffect(() => {
    owner.current = pairing;
  }, [pairing]);
  return owner;
}

/**
 * Builds the two ways the visible request can leave: dismiss, or answer.
 * @param queue - The pending ref, snoozes, setter, and owning pairing.
 * @returns The dismiss and answer callbacks.
 */
function useOtpDismissals({
  pendingRef,
  snoozedUntil,
  setPending,
  pairing,
}: DismissalQueue): Pick<OtpWatcher, 'dismiss' | 'clearAnswered'> {
  // A callback retained across a pairing change must compare against the live
  // queue owner, not the one captured when it was created.
  const ownerRef = useQueueOwner(pairing);

  const dismiss = useCallback(
    (requestId: string, deadline: number, ownerPairing: number) => {
      // A late callback from the previous prompt must not touch the queue that
      // replaced it, even when the new pairing reuses the request id.
      if (ownerPairing !== ownerRef.current) {
        return;
      }
      const current = pendingRef.current;
      // Record the snooze for the named request even if a newer one is on
      // screen: a late dismissal must not shorten an answer's quiet window.
      const quietUntil = snoozeUntil(deadline);
      snoozedUntil.current.set(
        requestId,
        Math.max(snoozedUntil.current.get(requestId) ?? 0, quietUntil),
      );
      if (current?.id === requestId) {
        pendingRef.current = null;
        setPending(null);
      }
    },
    [ownerRef, pendingRef, setPending, snoozedUntil],
  );

  const clearAnswered = useCallback(
    (requestId: string, deadline: number, ownerPairing: number) => {
      if (ownerPairing !== ownerRef.current) {
        return;
      }
      // Suppress until the request itself ends: a fixed quiet period can expire
      // while a lagging importer still lists it, which re-prompts the answer.
      snoozedUntil.current.set(requestId, deadline);
      if (pendingRef.current?.id === requestId) {
        pendingRef.current = null;
        setPending(null);
      }
    },
    [ownerRef, pendingRef, setPending, snoozedUntil],
  );

  return { dismiss, clearAnswered };
}

/**
 * Provides the next pending OTP request, its dismiss/answer callbacks, and the
 * per-request markers that keep automatic submission single-shot.
 * @returns The pending request, callbacks, and markers.
 */
export function useOtpWatcher(): OtpWatcher {
  const { connection, pairing } = useAuth();
  const queue = useOtpQueue();
  useOtpPolling({
    connection,
    pairing,
    applyRequests: queue.applyRequests,
    reset: queue.reset,
  });
  const { dismiss, clearAnswered } = useOtpDismissals({
    pendingRef: queue.pendingRef,
    snoozedUntil: queue.snoozedUntil,
    setPending: queue.setPending,
    pairing,
  });
  return {
    pending: queue.pending,
    dismiss,
    clearAnswered,
    autoSubmitted: queue.autoSubmitted,
    markAutoSubmitted: queue.markAutoSubmitted,
  };
}
