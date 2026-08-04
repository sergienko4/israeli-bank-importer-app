/**
 * Decides whether the background capture path may run at all.
 *
 * The Android grant is answered once and then stays granted, so the runtime
 * permission cannot express "stop doing this". The two switches the user can
 * still move are the only thing that can, which makes this the gate that has to
 * be consulted before a message is examined or a code is sent.
 *
 * Both switches are required, not either. Auto-read with auto-submit off means
 * the user wants to confirm each code, and the background path has no way to
 * offer that: when the process was started by an arriving message there is no
 * screen to fill in, and holding the code until one appears would store a
 * one-time code the app promises never to keep. The foreground consent prompt
 * already serves that combination, so the background window simply stays shut.
 *
 * The channel is the third condition, and it is not a switch the user moves
 * here. When the importer collects codes over Telegram it never asks this app
 * for one, so a message read on this device could never be spent — and the two
 * switches are hidden on that channel, which would otherwise leave a receiver
 * collecting bank messages with nothing on screen to turn it off.
 */
import { loadOtpAutoRead } from './otpAutoReadStore';
import { loadOtpAutoSubmit } from './otpAutoSubmitStore';
import { loadOtpChannelIsApp } from './otpChannelStore';

/**
 * Whether the user's switches and the active channel together permit capture.
 *
 * @param autoRead - Whether the user allows codes to be read from messages.
 * @param autoSubmit - Whether the user allows a code to be sent unconfirmed.
 * @param channelIsApp - Whether the importer collects codes in this app.
 * @returns True only when all three are on.
 */
export function backgroundCaptureAllowed(
  autoRead: boolean,
  autoSubmit: boolean,
  channelIsApp: boolean,
): boolean {
  return autoRead && autoSubmit && channelIsApp;
}

/**
 * Reads the stored preferences and applies {@link backgroundCaptureAllowed}.
 *
 * Every store resolves to off when unreadable, so a broken keystore closes the
 * window rather than leaving an SMS-reading path running unseen.
 *
 * @returns True only when both switches are on and the channel is this app.
 */
export async function loadBackgroundCaptureAllowed(): Promise<boolean> {
  const [autoRead, autoSubmit, channelIsApp] = await Promise.all([
    loadOtpAutoRead(),
    loadOtpAutoSubmit(),
    loadOtpChannelIsApp(),
  ]);
  return backgroundCaptureAllowed(autoRead, autoSubmit, channelIsApp);
}
