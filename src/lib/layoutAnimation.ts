/**
 * Thin wrapper over LayoutAnimation so list add/remove changes animate smoothly.
 * Enables the feature on Android's legacy architecture (a no-op elsewhere) and
 * skips the animation entirely when the user has asked to reduce motion.
 */
import { LayoutAnimation, Platform, UIManager } from 'react-native';

import { durations } from '../theme/motion';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/**
 * Schedules an animated transition for the next layout change (e.g. adding or
 * removing a list item).
 * @param reduced - Whether reduced motion is enabled; when true, does nothing.
 */
export function animateNextLayout(reduced: boolean): void {
  if (reduced) {
    return;
  }
  LayoutAnimation.configureNext({
    duration: durations.base,
    create: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity },
    update: { type: LayoutAnimation.Types.easeInEaseOut },
    delete: { type: LayoutAnimation.Types.easeIn, property: LayoutAnimation.Properties.opacity },
  });
}
