/**
 * Reconcilies the cached OTP channel with the importer on a bounded schedule.
 *
 * The channel can change from the importer's own UI, and off the app channel
 * the switches that would close capture are hidden, so polls refresh it every
 * few minutes. A failed read or cache write backs off from one poll up to the
 * normal interval; a successful read resets the backoff.
 */
import type { Session } from '../api/importerClient';
import { isChannelCacheDirty, refreshOtpChannel } from '../lib/otpChannelSync';
import { withRequestTimeout } from '../lib/requestTimeout';

/** How often the channel is reconciled after a successful read. */
const CHANNEL_REFRESH_MS = 5 * 60_000;
/** A channel read that hangs must not keep the refresh gate shut. */
const CHANNEL_TIMEOUT_MS = 20_000;
/** The shortest delay before retrying a failed read or dirty cache. */
const CHANNEL_RETRY_START_MS = 5_000;

/** When the next normal refresh and the next retry may run. */
interface RefreshPlan {
  readonly nextAt: number;
  readonly retryAt: number;
  readonly retryDelay: number;
}

/**
 * Plans the next refresh after one result.
 * @param ok - Whether the read and cache write both succeeded.
 * @param now - Current time in epoch ms.
 * @param delay - The current retry delay.
 * @returns The next normal time, retry time, and backoff.
 */
function planRefresh(ok: boolean, now: number, delay: number): RefreshPlan {
  if (ok) {
    return { nextAt: now + CHANNEL_REFRESH_MS, retryAt: 0, retryDelay: CHANNEL_RETRY_START_MS };
  }
  return {
    nextAt: 0,
    retryAt: now + delay,
    retryDelay: Math.min(delay * 2, CHANNEL_REFRESH_MS),
  };
}

/**
 * Reports whether a refresh is due.
 * @param nextAt - The next normal refresh time.
 * @param retryAt - The next retry time after a failure.
 * @param dirty - Whether the device cache needs a retry.
 * @returns True when the normal refresh or a dirty retry may run.
 */
function isDue(nextAt: number, retryAt: number, dirty: boolean): boolean {
  const now = Date.now();
  return (now >= nextAt && now >= retryAt) || (dirty && now >= retryAt);
}

/**
 * Builds the bounded channel refresh used by the poll loop.
 * @param getConnection - Reads the current session.
 * @param isActive - Reports whether the loop is still mounted.
 * @returns A function that refreshes when due.
 */
export function createChannelRefresh(
  getConnection: () => Session | null,
  isActive: () => boolean,
): () => void {
  let nextAt = 0;
  let retryAt = 0;
  let retryDelay = CHANNEL_RETRY_START_MS;
  let inFlight = false;
  return () => {
    const connection = getConnection();
    if (!connection || inFlight || !isDue(nextAt, retryAt, isChannelCacheDirty())) {
      return;
    }
    inFlight = true;
    nextAt = Date.now() + CHANNEL_REFRESH_MS;
    let expired = false;
    const finish = (ok: boolean): void => {
      const plan = planRefresh(ok, Date.now(), retryDelay);
      nextAt = plan.nextAt;
      retryAt = plan.retryAt;
      retryDelay = plan.retryDelay;
      inFlight = false;
    };
    void withRequestTimeout(
      refreshOtpChannel(
        connection,
        () => !expired && isActive() && getConnection()?.baseUrl === connection.baseUrl,
      ),
      CHANNEL_TIMEOUT_MS,
    )
      .then((result) => {
        finish(result.status === 'ok');
      })
      .catch(() => {
        expired = true;
        finish(false);
      });
  };
}
