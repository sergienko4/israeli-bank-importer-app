/**
 * Opens the auto-read window when a push arrives and no app is running.
 *
 * The window is normally opened by the screen that polls the importer, which
 * needs a live process. A scrape scheduled overnight is the opposite case: the
 * importer raises a code request while the app is not running, nothing polls,
 * the window stays shut and the message that follows is ignored. A push is the
 * only thing that can start the process in time.
 *
 * The push itself carries no authority. Anyone holding this device's Expo push
 * token could send one, so acting on its payload would let an outsider decide
 * when the app may read messages. Instead the push is treated as a nudge and
 * nothing more: the importer's own authenticated pending list decides whether
 * the window opens, exactly as it does when the app is on screen. A forged
 * push therefore costs one extra poll and achieves nothing else.
 */
import type { Session } from '../api/importerClient';
import type { PendingOtpRequest } from '../api/otp';
import { autoReadWindowDeadline } from './otpAutoReadWindow';

/**
 * Everything the wake needs from the outside world.
 *
 * Injected rather than imported so the decision can be tested without a
 * device, a network, or a delivered notification.
 */
export interface PushWakePorts {
  /** The stored connection, or null when the device is not paired. */
  readonly loadSession: () => Promise<Session | null>;
  /** The importer's current outstanding one-time-code requests. */
  readonly getPending: (session: Session) => Promise<PendingOtpRequest[]>;
  /** Writes the window the native receiver reads. */
  readonly syncWindow: (pending: readonly PendingOtpRequest[]) => Promise<void>;
  /** The current time, injected so expiry is testable. */
  readonly now: () => number;
}

/**
 * What the wake concluded.
 *
 * `failed` is distinct from the rest because it is the one case where the
 * window is left untouched rather than deliberately set.
 */
export type PushWakeOutcome = 'no-session' | 'nothing-pending' | 'window-open' | 'failed';

/**
 * Brings the auto-read window up to date after a push.
 *
 * @param ports - The injected outside world.
 * @returns What it concluded, for tests and callers that want to know.
 */
export async function wakeAutoReadWindow(ports: PushWakePorts): Promise<PushWakeOutcome> {
  try {
    const session = await ports.loadSession();
    if (session === null) {
      await ports.syncWindow([]);
      return 'no-session';
    }
    const pending = await ports.getPending(session);
    await ports.syncWindow(pending);
    return autoReadWindowDeadline(pending, ports.now()) === null
      ? 'nothing-pending'
      : 'window-open';
  } catch {
    // Deliberately silent: this runs with no screen to report to, and the
    // window it would have closed expires by itself.
    return 'failed';
  }
}
