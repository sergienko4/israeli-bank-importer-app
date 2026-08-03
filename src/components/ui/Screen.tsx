/**
 * Screen scaffold: paints the themed background, honors safe-area insets, and
 * optionally hosts a fixed header, a scrollable body, and a fixed footer (for
 * sticky action bars). Keeps every screen's layout consistent.
 *
 * Keyboard avoidance lives here rather than at each call site. Android 15
 * enforces edge-to-edge, so `adjustResize` no longer shrinks the window and the
 * IME simply draws over the app; without this every screen would need its own
 * fix and the next form added would quietly reintroduce the bug. Handling it in
 * the scaffold is what keeps *all* fields visible, not only the ones someone
 * remembered to patch.
 */
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { useCallback, useState } from 'react';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  KeyboardAvoidingView,
  KeyboardAwareScrollView,
  KeyboardStickyView,
} from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { computeFocusedFieldOffset, computeStickyFooterOffset } from '../../lib/keyboardInset';
import { useTheme } from '../../theme/ThemeContext';

interface ScreenProps {
  /** Body content. */
  children: ReactNode;
  /** Fixed header above the body (e.g. an AppHeader). */
  header?: ReactNode;
  /** Fixed footer below the body (e.g. a sticky save bar). */
  footer?: ReactNode;
  /**
   * A message pinned between the body and the footer.
   *
   * Anything reporting the outcome of the footer's action belongs here rather
   * than at the end of the body. The footer never scrolls away, so an error
   * placed after a long form is off screen at the exact moment the user is
   * looking at the button that produced it.
   */
  notice?: ReactNode;
  /** Scroll the body. Default true. */
  scroll?: boolean;
  /** Pad the body. Default true. */
  padded?: boolean;
  /** Extra body content style. */
  contentStyle?: StyleProp<ViewStyle>;
  /** Optional pull-to-refresh element passed to ScrollView. */
  refreshControl?: NonNullable<ComponentProps<typeof ScrollView>['refreshControl']>;
}

/** Keeps a long validation list from swallowing the screen it is reporting on. */
const NOTICE_MAX_HEIGHT = 200;

interface BottomClusterProps {
  notice?: ReactNode;
  footer?: ReactNode;
  onLayout: (event: LayoutChangeEvent) => void;
}

/**
 * Renders the notice and footer as one block that rides above the keyboard.
 *
 * They lift together because a notice left behind the keyboard reports the
 * outcome of a button the user can no longer see.
 * @param props - Notice, footer, and the layout callback that measures them.
 * @returns The sticky bottom cluster.
 */
function BottomCluster({ notice, footer, onLayout }: Readonly<BottomClusterProps>): ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardStickyView
      offset={{ closed: 0, opened: computeStickyFooterOffset(insets.bottom) }}
      onLayout={onLayout}
      style={{ backgroundColor: theme.colors.bg }}
    >
      {notice ? (
        <ScrollView
          style={{ maxHeight: NOTICE_MAX_HEIGHT }}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.sm,
            paddingBottom: footer ? theme.spacing.sm : insets.bottom || theme.spacing.md,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {notice}
        </ScrollView>
      ) : null}
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
    </KeyboardStickyView>
  );
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
  notice,
  scroll = true,
  padded = true,
  contentStyle,
  refreshControl,
}: Readonly<ScreenProps>): ReactElement {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pad = padded ? theme.spacing.lg : 0;
  const [bottomClusterHeight, setBottomClusterHeight] = useState(0);

  const measureBottomCluster = useCallback((event: LayoutChangeEvent) => {
    setBottomClusterHeight(event.nativeEvent.layout.height);
  }, []);

  const hasBottomCluster = Boolean(notice) || Boolean(footer);

  // The cluster is lifted over the body when the keyboard opens, so the focused
  // field has to clear the keyboard *and* the cluster, not just the keyboard.
  const bottomOffset = computeFocusedFieldOffset({
    footerHeight: hasBottomCluster ? bottomClusterHeight : 0,
    extraGap: theme.spacing.md,
  });

  const contentContainerStyle = [
    { padding: pad, paddingBottom: pad + theme.spacing.xl },
    contentStyle,
  ];

  const body = scroll ? (
    <KeyboardAwareScrollView
      style={styles.flex}
      contentContainerStyle={contentContainerStyle}
      bottomOffset={bottomOffset}
      keyboardShouldPersistTaps="handled"
      // Not "interactive": React Native ignores that value on Android and falls
      // back to "none", so on the only platform this app ships it would be a
      // no-op. "on-drag" gives the user a gesture to push the keyboard away.
      keyboardDismissMode="on-drag"
      refreshControl={refreshControl}
    >
      {children}
    </KeyboardAwareScrollView>
  ) : (
    // A non-scrolling body cannot scroll a field out from under the keyboard,
    // so it is resized instead. Today these are list and status screens with no
    // input, but leaving the branch unprotected means the first field added here
    // is invisible while being typed into — the exact bug this change fixes, and
    // one the `TextInput` lint guard cannot see because it is a layout choice.
    <KeyboardAvoidingView behavior="padding" style={[styles.flex, { padding: pad }, contentStyle]}>
      {children}
    </KeyboardAvoidingView>
  );

  return (
    <View style={[styles.flex, { backgroundColor: theme.colors.bg, paddingTop: insets.top }]}>
      {header}
      {body}
      {hasBottomCluster ? (
        <BottomCluster notice={notice} footer={footer} onLayout={measureBottomCluster} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
