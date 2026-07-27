/**
 * Entrance animation wrapper: fades and slides its children up on mount, with an
 * optional stagger derived from a list index. Uses the built-in Animated API
 * (native driver) so it runs smoothly without extra native dependencies.
 */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Animated, Easing } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

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
 * Animates children in with a fade + slide.
 * @param props - Entrance configuration.
 * @returns The animated container element.
 */
export function Entrance({
  children, index = 0, axis = 'y', distance = 14, style,
}: EntranceProps) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 340,
      delay: Math.min(index, 10) * 45,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => { animation.stop(); };
  }, [progress, index]);

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
