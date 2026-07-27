/**
 * Home dashboard tab: confirms the active connection and offers quick actions
 * that switch to the Config, Banks, or Status tabs. Navigation between top-level
 * destinations is handled by the tab bar in {@link AppShell}.
 */
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../auth/AuthContext';
import {
  Button, Card, Divider, ListRow, Screen, StatusPill,
} from '../components/ui';
import { haptics } from '../lib/haptics';
import { useTheme } from '../theme/ThemeContext';

/** The tabs the Home quick actions can jump to. */
export type HomeTarget = 'config' | 'banks' | 'status';

interface Props {
  /** Switches the active tab (used by the quick actions). */
  onNavigate: (tab: HomeTarget) => void;
}

/**
 * Shows the connection summary and quick actions.
 * @param props - Callback to switch tabs.
 * @returns The home dashboard element.
 */
export function HomeScreen({ onNavigate }: Props) {
  const theme = useTheme();
  const { connection, disconnect } = useAuth();

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.brandRow}>
        <View style={[styles.logo, { backgroundColor: theme.colors.primary, borderRadius: theme.radius.md }]}>
          <Ionicons name="wallet" size={20} color={theme.colors.onPrimary} />
        </View>
        <Text style={[theme.typography.h1, { color: theme.colors.text }]}>Bank Importer</Text>
      </View>

      <Card style={styles.connection} elevation={2}>
        <View style={styles.connectionTop}>
          <Text style={[theme.typography.caption, styles.eyebrow, { color: theme.colors.textSubtle }]}>IMPORTER</Text>
          <StatusPill label="Connected" tone="success" />
        </View>
        <Text style={[theme.typography.h3, { color: theme.colors.text }]} numberOfLines={1}>
          {connection?.baseUrl}
        </Text>
      </Card>

      <Text style={[theme.typography.caption, styles.section, { color: theme.colors.textSubtle }]}>MANAGE</Text>
      <Card padded={false} style={styles.menu}>
        <ListRow
          icon="options-outline"
          title="Configuration"
          subtitle="Actual Budget, notifications, schedule"
          onPress={() => { onNavigate('config'); }}
        />
        <Divider style={styles.indent} />
        <ListRow
          icon="business-outline"
          title="Banks"
          subtitle="Add or edit your bank accounts"
          onPress={() => { onNavigate('banks'); }}
        />
        <Divider style={styles.indent} />
        <ListRow
          icon="pulse-outline"
          title="Import status"
          subtitle="Recent runs and results"
          onPress={() => { onNavigate('status'); }}
        />
      </Card>

      <Button
        title="Disconnect"
        icon="log-out-outline"
        variant="secondary"
        onPress={() => { haptics.medium(); void disconnect(); }}
        style={styles.disconnect}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  logo: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  connection: { gap: 10 },
  connectionTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { letterSpacing: 0.6 },
  section: { letterSpacing: 0.6, marginTop: 12, marginLeft: 4 },
  menu: { overflow: 'hidden' },
  indent: { marginLeft: 68 },
  disconnect: { marginTop: 16 },
});
