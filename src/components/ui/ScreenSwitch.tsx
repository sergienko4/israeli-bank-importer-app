/**
 * Direction-aware screen transition with edge-swipe-back. Wraps the active
 * screen of the app's lightweight screen-enum router and animates it in from the
 * right when navigating forward and from the left when navigating back, using
 * the built-in Animated API. When `onSwipeBack` is provided, a drag that starts
 * at the left edge follows the finger and triggers the back navigation once it
 * passes a distance or velocity threshold — no gesture-handler dependency.
 *
 * Honors reduced motion: transitions snap into place and the swipe still works
 * but without the follow animation being required to feel responsive.
 */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import {
  Animated, PanResponder, StyleSheet, useWindowDimensions,
} from 'react-native';

import { useReducedMotion } from '../../lib/useReducedMotion';
import {
  durations, easing, motionDuration, spring,
} from '../../theme/motion';

/** Width of the left-edge zone that starts a swipe-back gesture. */
const EDGE_WIDTH = 32;
/** Fraction of screen width past which release completes the back navigation. */
const SWIPE_THRESHOLD_RATIO = 0.4;
/** Horizontal velocity past which release completes the back navigation. */
const VELOCITY_THRESHOLD = 0.5;

interface ScreenSwitchProps {
  /** The active screen's key; a change drives the transition. */
  screenKey: string;
  /** Navigation direction used to pick the slide-in side. */
  direction: 'forward' | 'back';
  /** Enables edge-swipe-back and is called when the gesture completes. */
  onSwipeBack?: () => void;
  /** The active screen content. */
  children: ReactNode;
}

/**
 * Renders the active screen with a direction-aware transition and optional
 * edge-swipe-back.
 * @param props - The screen key, direction, swipe handler, and content.
 * @returns The animated screen container.
 */
export function ScreenSwitch({
  screenKey, direction, onSwipeBack, children,
}: ScreenSwitchProps) {
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const translateX = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const firstRender = useRef(true);

  const onSwipeBackRef = useRef(onSwipeBack);
  const reducedRef = useRef(reduced);
  const widthRef = useRef(width);

  useEffect(() => {
    onSwipeBackRef.current = onSwipeBack;
  }, [onSwipeBack]);

  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return undefined;
    }
    const reducedNow = reducedRef.current;
    const currentWidth = widthRef.current;
    const start = direction === 'forward' ? currentWidth : -currentWidth * 0.35;
    translateX.setValue(reducedNow ? 0 : start);
    opacity.setValue(reducedNow ? 1 : 0);
    const animation = Animated.parallel([
      Animated.timing(translateX, {
        toValue: 0, duration: motionDuration(durations.base, reducedNow), easing: easing.standard, useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1, duration: motionDuration(durations.base, reducedNow), easing: easing.standard, useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => { animation.stop(); };
  }, [screenKey, direction, translateX, opacity]);

  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (evt, gesture) => {
        if (!onSwipeBackRef.current) {
          return false;
        }
        const startX = evt.nativeEvent.pageX - gesture.dx;
        return startX <= EDGE_WIDTH && gesture.dx > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy);
      },
      onPanResponderMove: (_evt, gesture) => {
        if (gesture.dx > 0) {
          translateX.setValue(gesture.dx);
        }
      },
      onPanResponderRelease: (_evt, gesture) => {
        const back = onSwipeBackRef.current;
        const swipeThreshold = widthRef.current * SWIPE_THRESHOLD_RATIO;
        if (back && (gesture.dx > swipeThreshold || gesture.vx > VELOCITY_THRESHOLD)) {
          Animated.timing(translateX, {
            toValue: widthRef.current,
            duration: motionDuration(durations.fast, reducedRef.current),
            easing: easing.accelerate,
            useNativeDriver: true,
          }).start(() => { back(); });
        } else {
          if (reducedRef.current) {
            translateX.setValue(0);
            return;
          }
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true, ...spring.settle }).start();
        }
      },
    }),
  ).current;

  return (
    <Animated.View
      style={[styles.fill, { opacity, transform: [{ translateX }] }]}
      {...responder.panHandlers}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
