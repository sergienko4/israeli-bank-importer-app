/**
 * Watches for pending app-OTP requests while connected: polls the importer on
 * an interval and refreshes immediately when an OTP push arrives, surfacing the
 * next request the user should answer. Polling means a missed push still shows
 * the prompt. Dismissed requests are suppressed for the session.
 */
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getPendingOtp } from '../api/importerClient';
import type { PendingOtpRequest } from '../api/otp';
import { useAuth } from '../auth/AuthContext';
import { selectPendingOtp } from '../lib/otpQueue';

const POLL_INTERVAL_MS = 5000;

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
      return undefined;
    }
    let active = true;
    const poll = async () => {
      try {
        const requests = await getPendingOtp(connection);
        if (active) {
          setPending(selectPendingOtp(requests, dismissed.current));
        }
      } catch {
        // Best-effort; the next tick retries.
      }
    };
    void poll();
    const interval = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
    const sub = Notifications.addNotificationReceivedListener(() => { void poll(); });
    return () => {
      active = false;
      clearInterval(interval);
      sub.remove();
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
