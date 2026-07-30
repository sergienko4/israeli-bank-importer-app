/**
 * Screen scaffold: paints the themed background, honors safe-area insets, and
 * optionally hosts a fixed header, a scrollable body, and a fixed footer (for
 * sticky action bars). Keeps every screen's layout consistent.
 */
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../../theme/ThemeContext';

interface ScreenProps {
  /** Body content. */
  children: ReactNode;
  /** Fixed header above the body (e.g. an AppHeader). */
  header?: ReactNode;
  /** Fixed footer below the body (e.g. a sticky save bar). */
  footer?: ReactNode;
  /** Scroll the body. Default true. */
  scroll?: boolean;
  /** Pad the body. Default true. */
  padded?: boolean;
  /** Extra body content style. */
  contentStyle?: StyleProp<ViewStyle>;
  /** Optional pull-to-refresh element passed to ScrollView. */
  refreshControl?: NonNullable<ComponentProps<typeof ScrollView>['refreshControl']>;
}

/**
 * Renders the themed screen scaffold.
 * @param props - Screen configuration.
 * @returns The screen element.
 */
export function Screen({
  children,
  header,
  footer,
  scroll = true,
  padded = true,
  contentStyle,
  refreshControl,
}: Readonly<ScreenProps>): ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pad = padded ? theme.spacing.lg : 0;
  const body = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[
        { padding: pad, paddingBottom: pad + theme.spacing.xl },
        contentStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, { padding: pad }, contentStyle]}>{children}</View>
  );

  return (
    <View style={[styles.flex, { backgroundColor: theme.colors.bg, paddingTop: insets.top }]}>
      {header}
      {body}
      {footer ? (
        <View
          style={{
            paddingBottom: insets.bottom || theme.spacing.md,
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.md,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
            backgroundColor: theme.colors.surface,
          }}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
