/**
 * Remembers which OTP channel the importer is set to, so the device can answer
 * that question with no network.
 *
 * The channel itself belongs to the importer, not to this phone, but the SMS
 * receiver has to decide whether to keep a message with no session and often no
 * JavaScript alive. It cannot ask the importer, so the last answer the app was
 * given is cached here and read as part of the capture gate.
 *
 * An absent or unreadable entry reads as "not the app channel". A device that
 * has never been told which channel is in use has no reason to be collecting
 * bank messages, so the quiet failure is the one that stops capturing rather
 * than the one that keeps it running unseen.
 */
import * as SecureStore from 'expo-secure-store';

import type { OtpChannel } from '../api/otp';
import { writeSwitch } from './otpCaptureSwitch';

const CHANNEL_KEY = 'otp.channel.v1';

/** The only stored value that marks this device as using the app channel. */
const APP = 'app';

/**
 * Reads whether the importer was last known to collect codes in this app.
 *
 * Defaults to false, and stays false for an absent, corrupt, or unreadable
 * entry, so capture stops rather than continuing on a stale assumption.
 * @returns True only when the cached channel is the app channel.
 */
export async function loadOtpChannelIsApp(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(CHANNEL_KEY)) === APP;
  } catch {
    // A locked or corrupt keystore must not leave an SMS-reading path enabled.
    return false;
  }
}

/** Thrown when the pairing changed before a queued channel write ran. */
export class StaleChannelOwnerError extends Error {
  constructor() {
    super('The importer changed before the channel write ran.');
    this.name = 'StaleChannelOwnerError';
  }
}

/**
 * Caches the channel the importer just reported.
 *
 * The owner check runs inside the capture-switch turn, immediately before the
 * write: an importer change while this waited must not publish its channel to
 * the replacement. `onPublished` also runs inside that turn, after the write,
 * so the in-memory confirmation cannot outrun the stored value.
 * @param channel - The channel the importer is currently set to.
 * @param isCurrent - Reports whether the importer that confirmed it still owns
 *   the pairing.
 * @param onConfirmed - Runs after the owner check, before the write, so the
 *   in-memory answer is recorded even when SecureStore fails.
 * @throws When the secure store cannot be written, or the owner changed.
 */
export async function saveOtpChannel(
  channel: OtpChannel,
  isCurrent: () => boolean = () => true,
  onConfirmed: () => void = () => undefined,
): Promise<void> {
  await writeSwitch(async () => {
    if (!isCurrent()) {
      throw new StaleChannelOwnerError();
    }
    onConfirmed();
    await SecureStore.setItemAsync(CHANNEL_KEY, channel);
  });
}
