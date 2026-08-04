/**
 * Keeps the native hold flag in step with the user's switches.
 *
 * The receiver decides whether to hold a message with no JavaScript alive, so
 * it cannot consult the stored preferences. It reads a flag that lives beside
 * the held messages instead, and this is the only thing that writes it.
 *
 * Everything here fails closed. A preference that cannot be read, or a device
 * with no receiver to tell, both end with holding switched off: the cost is a
 * code the user types by hand, against the alternative of a receiver quietly
 * collecting messages after the user has said no.
 *
 * Turning the flag off also empties the stash, in the same native write, so
 * "not allowed to hold" and "still holding" cannot both be true.
 */
import { loadBackgroundCaptureAllowed } from './otpBackgroundGate';
import { stash } from './otpStashSource';

/** What syncing the flag needs, injected so it can be tested without a device. */
export interface StashGatePorts {
  /** Whether both user switches are currently on. */
  readonly isAllowed: () => Promise<boolean>;
  /** Writes the flag the receiver reads. */
  readonly setEnabled: (enabled: boolean) => void;
}

/**
 * Writes the user's current answer where the receiver can read it.
 *
 * @param ports - The injected preferences and native flag.
 * @returns Whether holding ended up allowed.
 */
export async function syncStashGate(ports: StashGatePorts): Promise<boolean> {
  try {
    const allowed = await ports.isAllowed();
    ports.setEnabled(allowed);
    return allowed;
  } catch {
    try {
      ports.setEnabled(false);
    } catch {
      // No receiver to tell, so there is nothing holding anything either.
    }
    return false;
  }
}

/**
 * Syncs the flag on this device.
 *
 * Called from each switch, so the receiver's answer never lags the user's.
 *
 * @returns Whether holding ended up allowed.
 */
export async function applyStashGate(): Promise<boolean> {
  return syncStashGate({
    isAllowed: loadBackgroundCaptureAllowed,
    setEnabled: stash.setEnabled,
  });
}

/**
 * Forgets every held message.
 *
 * Used when the device is unpaired: the messages were captured for an importer
 * this app can no longer reach, so nothing can ever spend them.
 */
export async function forgetHeldMessages(): Promise<void> {
  try {
    await stash.clear();
  } catch {
    // Nowhere to report to, and the entries expire on their own regardless.
  }
}
