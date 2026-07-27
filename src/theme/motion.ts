/**
 * Motion tokens: the single source of truth for animation timing, easing, and
 * spring physics so movement feels consistent and is tunable in one place.
 * Screens and primitives read these instead of hard-coding durations. Pair with
 * {@link ../lib/useReducedMotion} to collapse motion when the OS asks for it.
 */
import { Easing } from 'react-native';
import type { EasingFunction } from 'react-native';

/** Animation durations in milliseconds. */
export const durations = {
  /** No animation (used for the reduced-motion path). */
  instant: 0,
  /** Quick feedback (press, small state changes). */
  fast: 140,
  /** Standard transitions (sheets, fades). */
  base: 240,
  /** Larger entrances and screen changes. */
  slow: 320,
} as const;

/** Easing curves keyed by intent. */
export const easing: Record<'standard' | 'decelerate' | 'accelerate', EasingFunction> = {
  /** Symmetric ease for moves that start and end on screen. */
  standard: Easing.bezier(0.2, 0, 0, 1),
  /** Ease-out for elements entering (fast in, gentle settle). */
  decelerate: Easing.out(Easing.cubic),
  /** Ease-in for elements leaving. */
  accelerate: Easing.in(Easing.cubic),
};

/** Spring presets for `Animated.spring` (speed/bounciness form). */
export const spring = {
  /** Snappy depress on press-in. */
  press: { speed: 50, bounciness: 0 },
  /** Lively settle back on release. */
  settle: { speed: 40, bounciness: 6 },
  /** Softer physics for larger surfaces like the bottom sheet. */
  sheet: { speed: 16, bounciness: 4 },
} as const;

/** The scale a pressable settles to while held down. */
export const pressScale = 0.97;

/** Per-item stagger (ms) for list entrance animations. */
export const stagger = 45;

/**
 * Resolves an animation duration, collapsing it to zero when the user has asked
 * the OS to reduce motion.
 * @param ms - The intended duration in milliseconds.
 * @param reduced - Whether reduced motion is enabled.
 * @returns The duration to use (0 when reduced).
 */
export function motionDuration(ms: number, reduced: boolean): number {
  return reduced ? durations.instant : ms;
}

/**
 * Resolves an entrance stagger delay, collapsing it to zero under reduced motion.
 * @param index - The item's position in its list.
 * @param reduced - Whether reduced motion is enabled.
 * @returns The delay in milliseconds (0 when reduced).
 */
export function staggerDelay(index: number, reduced: boolean): number {
  return reduced ? 0 : Math.min(index, 10) * stagger;
}
