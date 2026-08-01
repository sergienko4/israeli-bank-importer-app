/**
 * Shared loading and error views for screen bodies. Kept consistent so every
 * screen surfaces progress and failures the same way.
 */
import { Ionicons } from '@expo/vector-icons';
import type { ReactElement } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../../theme/ThemeContext';
import { Button } from './Button';

/**
 * Centered loading indicator with an optional label.
 * @param props - Optional label under the spinner.
 * @returns The loader element.
 */
export function Loader({ label }: Readonly<{ label?: string }>): ReactElement {
  const theme = useTheme();
  return (
    <View
      style={styles.center}
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? 'Loading'}
    >
      <ActivityIndicator size="large" color={theme.colors.primary} />
      {label ? (
        <Text style={[theme.typography.small, { color: theme.colors.textMuted, marginTop: 12 }]}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

interface ErrorViewProps {
  /** Error message to display. */
  message: string;
  /** Retry handler; renders a primary "Try again" button when set. */
  onRetry?: () => void;
}

/**
 * Centered error state with an optional retry action.
 * @param props - The message and optional retry handler.
 * @returns The error view element.
 */
export function ErrorView({ message, onRetry }: Readonly<ErrorViewProps>): ReactElement {
  const theme = useTheme();
  return (
    <View style={styles.center} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <View
        style={[
          styles.bubble,
          { backgroundColor: theme.colors.dangerSoft, borderRadius: theme.radius.pill },
        ]}
      >
        <Ionicons name="warning-outline" size={28} color={theme.colors.danger} />
      </View>
      <Text style={[theme.typography.body, styles.message, { color: theme.colors.text }]}>
        {message}
      </Text>
      {onRetry ? (
        <View style={styles.action}>
          <Button title="Try again" icon="refresh" onPress={onRetry} fullWidth={false} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  bubble: {
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  message: { textAlign: 'center', maxWidth: 300 },
  action: { marginTop: 16 },
});
