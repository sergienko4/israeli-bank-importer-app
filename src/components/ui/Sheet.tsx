/**
 * Bottom sheet modal: a themed panel that springs up from the bottom over a
 * fading backdrop, with a grab handle and optional title. Stays mounted during
 * the close animation so the exit is smooth. Built on the Animated API + Modal,
 * and honors reduced motion by snapping open/closed.
 */
import type { ReactElement, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptics } from '../../lib/haptics';
import { useReducedMotion } from '../../lib/useReducedMotion';
import { durations, easing, motionDuration, spring } from '../../theme/motion';
import { useTheme } from '../../theme/ThemeContext';

interface SheetProps {
  /** Whether the sheet is open. */
  visible: boolean;
  /** Called when the backdrop or hardware back is used to dismiss. */
  onClose: () => void;
  /** Optional sheet title. */
  title?: string;
  /** Sheet content. */
  children: ReactNode;
}

/**
 * Renders an animated bottom sheet.
 * @param props - Sheet configuration.
 * @returns The sheet element, or null while fully closed.
 */
export function Sheet({
  visible,
  onClose,
  title,
  children,
}: Readonly<SheetProps>): ReactElement | null {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;
  const previousVisible = useRef(false);

  useEffect(() => {
    const wasVisible = previousVisible.current;
    previousVisible.current = visible;

    if (visible && !wasVisible) {
      setMounted(true);
      haptics.light();
      if (reducedMotion) {
        progress.setValue(1);
        return;
      }
      Animated.spring(progress, { toValue: 1, useNativeDriver: true, ...spring.sheet }).start();
      return;
    }

    if (!visible && wasVisible) {
      if (reducedMotion) {
        progress.setValue(0);
        setMounted(false);
        return;
      }
      Animated.timing(progress, {
        toValue: 0,
        duration: motionDuration(durations.base, reducedMotion),
        easing: easing.accelerate,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setMounted(false);
        }
      });
    }
  }, [visible, progress, reducedMotion]);

  if (!mounted) {
    return null;
  }

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: theme.colors.overlay, opacity: progress },
        ]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Close sheet"
          onPress={onClose}
        />
      </Animated.View>
      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: theme.colors.surface,
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
            paddingBottom: (insets.bottom || theme.spacing.md) + theme.spacing.sm,
            transform: [
              { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [560, 0] }) },
            ],
          },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: theme.colors.borderStrong }]} />
        {title ? (
          <Text style={[theme.typography.h2, styles.title, { color: theme.colors.text }]}>
            {title}
          </Text>
        ) : null}
        {children}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
    maxHeight: '80%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  title: { marginBottom: 12 },
});
