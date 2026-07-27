/**
 * Persistent bottom tab bar: 3-5 top-level destinations placed where the thumb
 * rests, each with an icon and a short label, a clear active state, generous
 * (>=48pt) touch targets, and safe-area padding. Follows mobile navigation best
 * practices — primary destinations stay visible rather than hidden in a menu.
 */
import { Ionicons } from '@expo/vector-icons';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptics } from '../../lib/haptics';
import { usePressScale } from '../../lib/usePressScale';
import { useTheme } from '../../theme/ThemeContext';

/** Minimum touch target per platform accessibility guidance. */
const MIN_TARGET = 48;

/** A single tab destination. */
export interface TabItem<T extends string> {
  /** Stable tab key. */
  key: T;
  /** Short visible label under the icon. */
  label: string;
  /** Icon when the tab is inactive. */
  icon: keyof typeof Ionicons.glyphMap;
  /** Icon when the tab is active (defaults to `icon`). */
  activeIcon?: keyof typeof Ionicons.glyphMap;
}

interface TabBarProps<T extends string> {
  /** The tabs to render, in order. */
  tabs: TabItem<T>[];
  /** The active tab key. */
  active: T;
  /** Called with the tab key when a tab is pressed. */
  onSelect: (key: T) => void;
}

interface TabButtonProps<T extends string> {
  tab: TabItem<T>;
  active: boolean;
  onSelect: (key: T) => void;
}

/**
 * Renders one tab: an icon over a label, tinted and bolded when active, with a
 * subtle press micro-interaction.
 * @param props - The tab, its active state, and the select handler.
 * @returns The tab button element.
 */
function TabButton<T extends string>({ tab, active, onSelect }: TabButtonProps<T>) {
  const theme = useTheme();
  const press = usePressScale(0.9);
  const color = active ? theme.colors.primary : theme.colors.textSubtle;
  const iconName = active ? (tab.activeIcon ?? tab.icon) : tab.icon;

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected: active }}
      hitSlop={4}
      onPress={() => {
        if (!active) {
          haptics.selection();
        }
        onSelect(tab.key);
      }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={styles.tab}
    >
      <Animated.View style={[styles.tabInner, { transform: [{ scale: press.scale }] }]}>
        <View
          style={[
            styles.indicator,
            { backgroundColor: active ? theme.colors.primary : 'transparent', borderRadius: theme.radius.pill },
          ]}
        />
        <Ionicons name={iconName} size={24} color={color} />
        <Text
          numberOfLines={1}
          style={[styles.label, { color, fontWeight: active ? '700' : '500' }]}
        >
          {tab.label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

/**
 * Renders the bottom tab bar.
 * @param props - The tabs, the active key, and the select handler.
 * @returns The tab bar element.
 */
export function TabBar<T extends string>({ tabs, active, onSelect }: TabBarProps<T>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.bar,
        {
          paddingBottom: insets.bottom || theme.spacing.sm,
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
        },
      ]}
    >
      {tabs.map((tab) => (
        <TabButton key={tab.key} tab={tab} active={tab.key === active} onSelect={onSelect} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingTop: 8,
  },
  tab: {
    flex: 1,
    minHeight: MIN_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabInner: { alignItems: 'center', gap: 3 },
  indicator: { width: 18, height: 3, marginBottom: 1 },
  label: { fontSize: 11, letterSpacing: 0.2 },
});
