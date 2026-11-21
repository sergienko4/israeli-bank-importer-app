/**
 * Watches for pending app-OTP requests while connected: polls the importer on
 * an interval and refreshes immediately when an OTP push arrives, surfacing the
 * next request the user should answer. Polling means a missed push still shows
 * the prompt. A dismissed request snoozes for a minute rather than disappearing
 * for the session, so an accidental dismissal is recoverable while the code is
 * still valid.
 */
import * as Notifications from 'expo-notifications';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Session } from '../api/importerClient';
import { getPendingOtp } from '../api/importerClient';
import type { PendingOtpRequest } from '../api/otp';
import { useAuth } from '../auth/AuthContext';
import { syncAutoReadWindow } from '../lib/otpAutoReadWindow';
import { refreshOtpChannel } from '../lib/otpChannelSync';
import { TASK_BUDGET_MS } from '../lib/otpDeadline';
import { pruneSnoozed, pruneUsed, selectPendingOtp, snoozeUntil } from '../lib/otpQueue';
import { drainHeldMessages } from '../lib/otpStashRunner';

const POLL_INTERVAL_MS = 5000;

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
 * Starts the serialized poll loop for one connection.
 *
 * One poll at a time: an older empty snapshot must not prune a snooze the newer
 * one created. A notification that arrives during a poll is picked up by the
 * next interval instead of racing it.
 * @param connection - The active session.
 * @param onRequests - Receives each successful read.
 * @returns A cleanup that stops the loop and closes SMS capture.
 */
function startOtpPolling(
  connection: Session,
  onRequests: (requests: PendingOtpRequest[]) => void,
): () => void {
  let active = true;
  // Once per connection, not per poll: the channel can be changed from the
  // importer's own UI, and off the app channel the switches that would close
  // capture are hidden, so this is the only thing that reconciles it.
  void refreshOtpChannel(connection);
  const pollOnce = createPoll(connection, (requests) => {
    if (active) {
      onRequests(requests);
    }
  });
  let polling = false;
  const poll = async (): Promise<void> => {
    if (polling) {
      return;
    }
    polling = true;
    try {
      await pollOnce();
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

/**
 * Snoozes the current request and clears the prompt.
 *
 * The optional id makes a late callback harmless: a submit for request A that
 * settles after B has been shown must not dismiss B.
 * @param setPending - The pending-request setter.
 * @param snoozedUntil - The per-request snooze map.
 * @param requestId - The request the caller is dismissing, when known.
 */
function dismissCurrent(
  setPending: Dispatch<SetStateAction<PendingOtpRequest | null>>,
  snoozedUntil: RefObject<Map<string, number>>,
  requestId?: string,
): void {
  setPending((current) => {
    if (current === null || (requestId !== undefined && current.id !== requestId)) {
      return current;
    }
    snoozedUntil.current.set(current.id, snoozeUntil(current.deadline));
    return null;
  });
}

/**
 * Records that a request used its automatic attempt.
 * @param setAutoSubmitted - The marker setter.
 * @param id - The request id.
 */
function markUsed(
  setAutoSubmitted: Dispatch<SetStateAction<ReadonlySet<string>>>,
  id: string,
): void {
  setAutoSubmitted((current) => {
    if (current.has(id)) {
      return current;
    }
    return new Set(current).add(id);
  });
}

/**
 * Provides the next pending OTP request, a dismiss callback, and the
 * per-request markers that keep automatic submission single-shot.
 * @returns The pending request (or null), the dismiss callback, and the markers.
 */
export function useOtpWatcher(): {
  pending: PendingOtpRequest | null;
  dismiss: (requestId?: string) => void;
  autoSubmitted: ReadonlySet<string>;
  markAutoSubmitted: (id: string) => void;
} {
  const { connection } = useAuth();
  const [pending, setPending] = useState<PendingOtpRequest | null>(null);
  const [autoSubmitted, setAutoSubmitted] = useState<ReadonlySet<string>>(new Set());
  const snoozedUntil = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!connection) {
      setPending(null);
      void syncAutoReadWindow([]);
      return undefined;
    }
    return startOtpPolling(connection, (requests) => {
      handleRequests(requests);
      snoozedUntil.current = pruneSnoozed(snoozedUntil.current, requests);
      setAutoSubmitted((current) => {
        const next = pruneUsed(current, requests);
        return next.size === current.size ? current : next;
      });
      setPending(selectPendingOtp(requests, snoozedUntil.current));
    });
  }, [connection]);

  const dismiss = useCallback((requestId?: string) => {
    dismissCurrent(setPending, snoozedUntil, requestId);
  }, []);

  const markAutoSubmitted = useCallback((id: string) => {
    markUsed(setAutoSubmitted, id);
  }, []);

  return { pending, dismiss, autoSubmitted, markAutoSubmitted };
}
