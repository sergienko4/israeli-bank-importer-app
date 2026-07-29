/**
 * Session-expired banner: a friendly, non-blocking overlay shown when the 12h
 * token expired and silent re-auth was unavailable or declined. Offers a single
 * tap to unlock (biometric quick-unlock) or reconnect (re-enter the password),
 * instead of leaving the user staring at failed requests.
 */
import { type ReactElement, useState } from 'react';

import { useAuth } from '../auth/AuthContext';
import { TopBanner } from '../components/ui';
import { haptics } from '../lib/haptics';

/**
 * Renders the session-expired reconnect banner (nothing when the session is ok).
 * @returns The banner element, or null when not needed.
 */
export function ReconnectBanner(): ReactElement | null {
  const { sessionExpired, quickUnlockEnabled, reauthenticate, disconnect } = useAuth();
  const [busy, setBusy] = useState(false);

  if (!sessionExpired) {
    return null;
  }

  const onReconnect = async (): Promise<void> => {
    setBusy(true);
    try {
      if (quickUnlockEnabled) {
        const result = await reauthenticate();
        haptics[result ? 'success' : 'warning']();
      } else {
        await disconnect();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <TopBanner
      icon="lock-closed"
      title="Session expired"
      detail={quickUnlockEnabled ? 'Unlock to reconnect securely.' : 'Reconnect to continue.'}
      actionTitle={quickUnlockEnabled ? 'Unlock' : 'Reconnect'}
      busy={busy}
      onPress={() => {
        void onReconnect();
      }}
    />
  );
}
