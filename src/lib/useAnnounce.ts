/**
 * Announces a message when it changes.
 *
 * `accessibilityLiveRegion` is Android-only and `accessibilityRole="alert"` is
 * not mapped to an iOS trait, so a visible error can be silent to VoiceOver.
 * This gives both platforms an explicit announcement.
 */
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/**
 * Announces a non-empty message whenever it changes.
 * @param message - The text to announce, or null when there is nothing to say.
 */
export function useAnnounceOnChange(message: string | null | undefined): void {
  const previous = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (message && message !== previous.current) {
      if (Platform.OS === 'ios') {
        // Queue behind the control the user just activated instead of dropping
        // the announcement while VoiceOver is still reading it.
        AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
      } else {
        AccessibilityInfo.announceForAccessibility(message);
      }
    }
    previous.current = message;
  }, [message]);
}
