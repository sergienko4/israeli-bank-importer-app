/**
 * Session-expired banner: a friendly, non-blocking overlay shown when the
 * session could not be renewed silently. Offers a single tap to unlock, instead
 * of leaving the user staring at failed requests.
 *
 * A session that ended for good never reaches here — the app returns to the
 * connect screen instead, because unlocking cannot bring it back.
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
  const { sessionExpired, reauthenticate } = useAuth();
  const [busy, setBusy] = useState(false);

  if (!sessionExpired) {
    return null;
  }

  const onReconnect = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await reauthenticate();
      haptics[result ? 'success' : 'warning']();
    } catch {
      haptics.warning();
    } finally {
      setBusy(false);
    }
  };

  return (
    <TopBanner
      icon="lock-closed"
      title="Session expired"
      detail="Unlock to reconnect securely."
      actionTitle="Unlock"
      busy={busy}
      onPress={() => {
        void onReconnect();
      }}
    />
  );
}
