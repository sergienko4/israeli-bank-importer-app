/**
 * Session-expired banner: a friendly, non-blocking overlay shown when the 12h
 * token expired and silent re-auth was unavailable or declined. Offers a single
 * tap to unlock (biometric quick-unlock) or reconnect (re-enter the password),
 * instead of leaving the user staring at failed requests.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/ui';
import { haptics } from '../lib/haptics';
import { useTheme } from '../theme/ThemeContext';

/**
 * Renders the session-expired reconnect banner (nothing when the session is ok).
 * @returns The banner element, or null when not needed.
 */
export function ReconnectBanner() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const {
    sessionExpired, quickUnlockEnabled, reauthenticate, disconnect,
  } = useAuth();
  const [busy, setBusy] = useState(false);

  if (!sessionExpired) {
    return null;
  }

  const onReconnect = async (): Promise<void> => {
    setBusy(true);
    try {
      if (quickUnlockEnabled) {
        const result = await reauthenticate();
        haptics[result ? 'success' : 'warning']();
      } else {
        await disconnect();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.wrap, { top: insets.top + theme.spacing.sm }]} pointerEvents="box-none">
      <View
        style={[
          styles.banner,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.lg,
          },
          theme.shadow(2),
        ]}
      >
        <View style={[styles.icon, { backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.pill }]}>
          <Ionicons name="lock-closed" size={16} color={theme.colors.primary} />
        </View>
        <View style={styles.text}>
          <Text style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>Session expired</Text>
          <Text style={[theme.typography.small, { color: theme.colors.textMuted }]}>
            {quickUnlockEnabled ? 'Unlock to reconnect securely.' : 'Reconnect to continue.'}
          </Text>
        </View>
        <Button
          title={quickUnlockEnabled ? 'Unlock' : 'Reconnect'}
          size="sm"
          fullWidth={false}
          loading={busy}
          onPress={() => { void onReconnect(); }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute', left: 12, right: 12, zIndex: 10,
  },
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: 1,
  },
  icon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
});
