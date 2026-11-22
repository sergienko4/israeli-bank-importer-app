/**
 * Watches for pending app-OTP requests while connected: polls the importer on
 * an interval and refreshes immediately when an OTP push arrives, surfacing the
 * next request the user should answer. Polling means a missed push still shows
 * the prompt. Dismissed requests are suppressed for the session.
 */
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Session } from '../api/importerClient';
import { getPendingOtp } from '../api/importerClient';
import type { PendingOtpRequest } from '../api/otp';
import { useAuth } from '../auth/AuthContext';
import { syncAutoReadWindow } from '../lib/otpAutoReadWindow';
import { refreshOtpChannel } from '../lib/otpChannelSync';
import { TASK_BUDGET_MS } from '../lib/otpDeadline';
import { selectPendingOtp } from '../lib/otpQueue';
import { drainHeldMessages } from '../lib/otpStashRunner';

const POLL_INTERVAL_MS = 5000;

/** Stands in for a pairing the user has not dismissed anything under. */
const NO_DISMISSALS = new Set<string>();

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

/** What the polling effect needs from the watcher. */
interface OtpPolling {
  /** The active importer session. */
  readonly connection: Session | null;
  /** The pairing generation that owns the session. */
  readonly pairing: number;
  /** Ids the user dismissed, per pairing generation. */
  readonly dismissed: Map<number, Set<string>>;
  /** Receives the next request with its pairing. */
  readonly onPending: (pending: OwnedPendingOtpRequest | null) => void;
}

/**
 * Polls for pending OTP requests while a connection is present.
 * @param polling - The session, its pairing, dismissed ids and sink.
 */
function useOtpPolling({ connection, pairing, dismissed, onPending }: OtpPolling): void {
  useEffect(() => {
    if (!connection) {
      onPending(null);
      void syncAutoReadWindow([]);
      return undefined;
    }
    let active = true;
    // Once per connection, not per poll: the channel can be changed from the
    // importer's own UI, and off the app channel the switches that would close
    // capture are hidden, so this is the only thing that reconciles it.
    void refreshOtpChannel(connection);
    const poll = createPoll(connection, (requests) => {
      if (!active) {
        return;
      }
      handleRequests(requests);
      const next = selectPendingOtp(requests, dismissed.get(pairing) ?? NO_DISMISSALS);
      onPending(next === null ? null : { ...next, pairing });
    });
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
  }, [connection, pairing, dismissed, onPending]);
}

/**
 * Provides the next pending OTP request and a way to dismiss the current one.
 * @returns The pending request (or null) and a dismiss callback.
 */
export function useOtpWatcher(): {
  pending: OwnedPendingOtpRequest | null;
  dismiss: (requestId: string) => void;
} {
  const { connection, pairing } = useAuth();
  const [pending, setPending] = useState<OwnedPendingOtpRequest | null>(null);
  // Dismissals belong to the pairing that showed the request: a later pairing
  // may reuse an id, and the old session's refusal must not hide it.
  const dismissed = useRef<Map<number, Set<string>>>(new Map());

  useOtpPolling({ connection, pairing, dismissed: dismissed.current, onPending: setPending });

  const dismiss = useCallback(
    (requestId: string) => {
      const dismissedForPairing = dismissed.current.get(pairing) ?? new Set<string>();
      dismissed.current.set(pairing, dismissedForPairing);
      dismissedForPairing.add(requestId);
      // Suppress the request the prompt showed, not whichever poll landed
      // since. A newer pending request must stay pending.
      setPending((current) => (current?.id === requestId ? null : current));
    },
    [pairing],
  );

  return { pending, dismiss };
}
