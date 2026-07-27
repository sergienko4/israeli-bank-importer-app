/**
 * Tracks the OS "Reduce Motion" accessibility setting so animations can be
 * shortened or skipped. Every animated primitive reads this to honor the user's
 * preference. Returns false until the initial query resolves.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Reports whether the user has enabled "Reduce Motion" at the OS level, updating
 * live when the setting changes.
 * @returns True when reduced motion is requested.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => { if (active) { setReduced(value); } })
      .catch(() => { /* default to motion enabled */ });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}
