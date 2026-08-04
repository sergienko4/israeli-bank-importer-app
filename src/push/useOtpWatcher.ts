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
import { selectPendingOtp } from '../lib/otpQueue';
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
    // natively; this is the moment it becomes answerable.
    void drainHeldMessages();
  }
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
    // Once per connection, not per poll: the channel can be changed from the
    // importer's own UI, and off the app channel the switches that would close
    // capture are hidden, so this is the only thing that reconciles it.
    void refreshOtpChannel(connection);
    const poll = createPoll(connection, (requests) => {
      if (!active) {
        return;
      }
      handleRequests(requests);
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
