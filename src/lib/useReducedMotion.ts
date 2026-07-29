import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Reads the platform Reduce Motion preference and updates when it changes.
 * @returns True when non-essential animations should complete instantly.
 */
export function useReducedMotion(): boolean {
  const [isReducedMotion, setIsReducedMotion] = useState(false);

  useEffect(() => {
    let isActive = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (isActive) {
          setIsReducedMotion(enabled);
        }
      })
      .catch(() => {
        // Best-effort: ignore failures reading the Reduce Motion preference.
      });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setIsReducedMotion,
    );
    return () => {
      isActive = false;
      subscription.remove();
    };
  }, []);

  return isReducedMotion;
}
