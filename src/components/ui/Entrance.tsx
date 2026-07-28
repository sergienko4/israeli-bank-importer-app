/**
 * Entrance animation wrapper: fades and slides its children up on mount, with an
 * optional stagger derived from a list index. Uses the built-in Animated API
 * (native driver) so it runs smoothly without extra native dependencies, and
 * collapses to an instant appearance when reduced motion is requested.
 */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Animated } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { useReducedMotion } from '../../lib/useReducedMotion';
import {
  durations, easing, motionDuration, staggerDelay,
} from '../../theme/motion';

interface EntranceProps {
  /** Content to animate in. */
  children: ReactNode;
  /** Position in a list; scales the start delay for a stagger effect. */
  index?: number;
  /** Vertical (default) or horizontal slide. */
  axis?: 'x' | 'y';
  /** Travel distance in px. Default 14. */
  distance?: number;
  /** Extra style on the animated container. */
  style?: StyleProp<ViewStyle>;
}

/**
 * Animates children in with a fade and slide transition.
 * @param props - Entrance configuration.
 * @returns The animated container element.
 */
export function Entrance({
  children, index = 0, axis = 'y', distance = 14, style,
}: EntranceProps) {
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reducedMotion) {
      progress.setValue(1);
      return undefined;
    }

    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: motionDuration(durations.slow, reducedMotion),
      delay: staggerDelay(index, reducedMotion),
      easing: easing.decelerate,
      useNativeDriver: true,
    });
    animation.start();
    return () => { animation.stop(); };
  }, [progress, index, reducedMotion]);

  const translate = progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] });
  return (
    <Animated.View
      style={[
        {
          opacity: progress,
          transform: [axis === 'x' ? { translateX: translate } : { translateY: translate }],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}
