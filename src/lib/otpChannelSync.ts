/**
 * Keeps the cached OTP channel, and the native capture flag that depends on it,
 * in step with the importer.
 *
 * The channel can change somewhere this app is not looking — the importer's own
 * web UI, or another phone — and the two switches that would otherwise turn
 * capture off are hidden whenever the channel is not this app. So the app
 * re-reads the channel whenever it has a session, and pushes the answer straight
 * through to the receiver.
 *
 * A failed read leaves the cache alone rather than clearing it: a flaky network
 * should not switch off a working setup. The gate is re-applied either way, so
 * the receiver always ends up holding whatever the device can actually prove.
 */
import type { Session } from '../api/importerClient';
import { getOtpSettings } from '../api/importerClient';
import type { OtpChannel } from '../api/otp';
import { saveOtpChannel } from './otpChannelStore';
import { applyStashGate } from './otpStashGate';

/**
 * Records a channel the importer just confirmed and re-syncs the capture flag.
 *
 * @param channel - The channel the importer is currently set to.
 * @returns Nothing; a cache that would not take is absorbed on purpose.
 */
export async function cacheOtpChannel(channel: OtpChannel): Promise<void> {
  try {
    await saveOtpChannel(channel);
  } catch {
    // A write that would not take must not stop the gate below from running:
    // re-applying it is what actually closes the receiver, and it fails closed.
  }
  await applyStashGate();
}

/**
 * Re-reads the importer's OTP channel and re-syncs the native capture flag.
 *
 * @param session - The active importer session.
 * @returns Nothing; failures are absorbed and reported to nobody by design.
 */
export async function refreshOtpChannel(session: Session): Promise<void> {
  try {
    const settings = await getOtpSettings(session);
    await cacheOtpChannel(settings.channel);
    return;
  } catch {
    // Unreachable importer: keep the last known channel and re-sync from it.
  }
  await applyStashGate();
}
