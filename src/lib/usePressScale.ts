/**
 * Press micro-interaction: a spring-driven scale that depresses a pressable on
 * press-in and settles it back on release, honoring reduced motion. Share this
 * across Button, ListRow, and Card so every tappable surface feels the same.
 */
import { useEffect, useState } from 'react';
import { Animated } from 'react-native';

import { pressScale as defaultPressScale, spring } from '../theme/motion';
import { useReducedMotion } from './useReducedMotion';

/** The animated scale value plus the press handlers to wire onto a Pressable. */
export interface PressScale {
  /** Drive an Animated.View transform `[{ scale }]` with this. */
  scale: Animated.Value;
  /** Attach to `onPressIn`. */
  onPressIn: () => void;
  /** Attach to `onPressOut`. */
  onPressOut: () => void;
}

/**
 * Provides a spring-animated press scale. No-ops (stays at 1) under isReduced
 * motion so the surface still responds without movement.
 * @param to - The scale to settle at while held. Defaults to the motion token.
 * @returns The animated scale value and press handlers.
 */
export function usePressScale(to: number = defaultPressScale): PressScale {
  const isReduced = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (isReduced) {
      scale.setValue(1);
    }
  }, [isReduced, scale]);

  const onPressIn = (): void => {
    if (isReduced) {
      return;
    }
    Animated.spring(scale, { toValue: to, useNativeDriver: true, ...spring.press }).start();
  };
  const onPressOut = (): void => {
    if (isReduced) {
      return;
    }
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, ...spring.settle }).start();
  };

  return { scale, onPressIn, onPressOut };
}
