/**
 * Thin wrapper around expo-haptics. Every call is fire-and-forget and swallows
 * errors, so haptics degrade to a no-op on devices/emulators without a haptics
 * engine. Import `haptics` and call the semantic helpers from interactions.
 */
import * as Haptics from 'expo-haptics';

/**
 * Runs a haptic effect, ignoring any platform error.
 * @param run - The haptic call to attempt.
 */
function fire(run: () => Promise<void>): void {
  void run().catch(() => { /* haptics unavailable — ignore */ });
}

/** Semantic haptic helpers used across the app. */
export const haptics = {
  /** Light tick for selection changes (tabs, chips, toggles). */
  selection: (): void => { fire(() => Haptics.selectionAsync()); },
  /** Light impact for taps (rows, buttons). */
  light: (): void => { fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)); },
  /** Medium impact for confirmations. */
  medium: (): void => { fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)); },
  /** Success notification (save/connect succeeded). */
  success: (): void => { fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)); },
  /** Warning notification (validation error). */
  warning: (): void => { fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)); },
  /** Error notification (failed action). */
  error: (): void => { fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)); },
};
