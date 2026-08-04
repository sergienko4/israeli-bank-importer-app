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

/**
 * Caches the channel the importer just reported.
 *
 * Write failures propagate so the caller can re-sync the capture gate from what
 * did stick rather than trusting a cache it never wrote.
 * @param channel - The channel the importer is currently set to.
 * @throws When the secure store cannot be written.
 */
export async function saveOtpChannel(channel: OtpChannel): Promise<void> {
  await SecureStore.setItemAsync(CHANNEL_KEY, channel);
}
