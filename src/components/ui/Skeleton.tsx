/**
 * Skeleton placeholders for loading states. A pulsing block plus list-shaped
 * helpers, so screens show their layout while data loads instead of a bare
 * spinner. Honors reduced motion by holding a steady dim instead of pulsing.
 */
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import type { DimensionValue, StyleProp, ViewStyle } from 'react-native';
import { Animated, StyleSheet, View } from 'react-native';

import { useReducedMotion } from '../../lib/useReducedMotion';
import { durations } from '../../theme/motion';
import { useTheme } from '../../theme/ThemeContext';
import { Card } from './Card';
import { Divider } from './Divider';

interface SkeletonProps {
  /** Block width. Default full width. */
  width?: DimensionValue;
  /** Block height in px. Default 16. */
  height?: number;
  /** Corner radius. Defaults to the theme's small radius. */
  radius?: number;
  /** Extra style. */
  style?: StyleProp<ViewStyle>;
}

/**
 * Renders a single pulsing placeholder block.
 * @param props - Size, radius, and style.
 * @returns The skeleton block element.
 */
export function Skeleton({
  width = '100%',
  height = 16,
  radius,
  style,
}: Readonly<SkeletonProps>): ReactElement {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const [pulse] = useState(() => new Animated.Value(0.5));

  useEffect(() => {
    if (reduced) {
      pulse.setValue(0.7);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: durations.slow, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: durations.slow, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [pulse, reduced]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width,
          height,
          borderRadius: radius ?? theme.radius.sm,
          backgroundColor: theme.colors.surfaceAlt,
          opacity: pulse,
        },
        style,
      ]}
    />
  );
}

/**
 * Renders a list-row-shaped skeleton: a leading bubble and two text lines.
 * @returns The skeleton row element.
 */
export function SkeletonRow(): ReactElement {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Skeleton width={40} height={40} radius={theme.radius.md} />
      <View style={styles.texts}>
        <Skeleton width="55%" height={14} />
        <Skeleton width="80%" height={12} />
      </View>
    </View>
  );
}

/**
 * Renders a card of skeleton rows for a loading list.
 * @param props - How many rows to render. Default 4.
 * @returns The skeleton list element.
 */
export function SkeletonList({ count = 4 }: Readonly<{ count?: number }>): ReactElement {
  return (
    <Card padded={false} style={styles.card}>
      {Array.from({ length: count }).map((_, index) => (
        <View key={`skeleton-${String(index)}`}>
          <SkeletonRow />
          {index < count - 1 ? <Divider style={styles.indent} /> : null}
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
  },
  texts: { flex: 1, gap: 8 },
  indent: { marginLeft: 68 },
});
