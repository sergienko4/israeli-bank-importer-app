/**
 * Mount entrance for small surfaces (pills, banners, empty states): a gentle
 * scale-and-fade in on first render, honoring reduced motion by appearing
 * instantly. Returns animated values to drive an Animated.View.
 */
import { useEffect, useState } from 'react';
import { Animated } from 'react-native';

import { durations, spring } from '../theme/motion';
import { useReducedMotion } from './useReducedMotion';

/** Animated scale and opacity to drive a mount-pop entrance. */
export interface MountPop {
  /** Spring scale from ~0.9 to 1. */
  scale: Animated.Value;
  /** Fade from 0 to 1. */
  opacity: Animated.Value;
}

/**
 * Provides scale/opacity values that animate in once on mount. Under isReduced
 * motion they start (and stay) at their resting values.
 * @param from - The starting scale. Defaults to 0.9.
 * @returns The animated scale and opacity.
 */
export function useMountPop(from = 0.9): MountPop {
  const isReduced = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(isReduced ? 1 : from));
  const [opacity] = useState(() => new Animated.Value(isReduced ? 1 : 0));

  useEffect(() => {
    if (isReduced) {
      scale.setValue(1);
      opacity.setValue(1);
      return undefined;
    }
    const animation = Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, ...spring.settle }),
      Animated.timing(opacity, { toValue: 1, duration: durations.base, useNativeDriver: true }),
    ]);
    animation.start();
    return () => {
      animation.stop();
    };
  }, [scale, opacity, isReduced]);

  return { scale, opacity };
}
