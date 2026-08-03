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
import { selectPendingOtp } from '../lib/otpQueue';

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
 * Provides the next pending OTP request and a way to dismiss the current one.
 * @returns The pending request (or null) and a dismiss callback.
 */
export function useOtpWatcher(): { pending: PendingOtpRequest | null; dismiss: () => void } {
  const { connection } = useAuth();
  const [pending, setPending] = useState<PendingOtpRequest | null>(null);
  const dismissed = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!connection) {
      setPending(null);
      void syncAutoReadWindow([]);
      return undefined;
    }
    let active = true;
    const poll = createPoll(connection, (requests) => {
      if (!active) {
        return;
      }
      // Tracks every pending request, not just the one shown: the native
      // receiver has to stay open as long as any code could still arrive.
      void syncAutoReadWindow(requests);
      setPending(selectPendingOtp(requests, dismissed.current));
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
  }, [connection]);

  const dismiss = useCallback(() => {
    setPending((current) => {
      if (current) {
        dismissed.current.add(current.id);
      }
      return null;
    });
  }, []);

  return { pending, dismiss };
}
