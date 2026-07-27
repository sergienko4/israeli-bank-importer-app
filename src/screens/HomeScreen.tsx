/**
 * Post-connection home: a dashboard confirming the active connection and
 * routing to the config editor, the banks editor, or the import status.
 * Navigation is a simple screen enum (no navigation library needed yet).
 */
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../auth/AuthContext';
import {
  Button, Card, Divider, ListRow, Screen, ScreenSwitch, StatusPill,
} from '../components/ui';
import { haptics } from '../lib/haptics';
import { useTheme } from '../theme/ThemeContext';
import { BanksScreen } from './BanksScreen';
import { ConfigScreen } from './ConfigScreen';
import { StatusScreen } from './StatusScreen';

type Tab = 'home' | 'config' | 'banks' | 'status';

/**
 * Shows the connection summary and routes to the editors.
 * @returns The home screen element.
 */
export function HomeScreen() {
  const theme = useTheme();
  const { connection, disconnect } = useAuth();
  const [screen, setScreen] = useState<Tab>('home');

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      setScreen('status');
    });
    return () => { sub.remove(); };
  }, []);

  const go = (tab: Tab): void => { haptics.selection(); setScreen(tab); };

  let active: ReactNode;
  if (screen === 'config') {
    active = <ConfigScreen onBack={() => { go('home'); }} />;
  } else if (screen === 'banks') {
    active = <BanksScreen onBack={() => { go('home'); }} />;
  } else if (screen === 'status') {
    active = <StatusScreen onBack={() => { go('home'); }} />;
  } else {
    active = (
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
            onPress={() => { go('config'); }}
          />
          <Divider style={styles.indent} />
          <ListRow
            icon="business-outline"
            title="Banks"
            subtitle="Add or edit your bank accounts"
            onPress={() => { go('banks'); }}
          />
          <Divider style={styles.indent} />
          <ListRow
            icon="pulse-outline"
            title="Import status"
            subtitle="Recent runs and results"
            onPress={() => { go('status'); }}
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

  return (
    <ScreenSwitch
      screenKey={screen}
      direction={screen === 'home' ? 'back' : 'forward'}
      onSwipeBack={screen === 'home' ? undefined : () => { go('home'); }}
    >
      {active}
    </ScreenSwitch>
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
