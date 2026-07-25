/**
 * Post-connection home: confirms the active connection and routes to the config
 * editor, the banks editor, or disconnect. Navigation is a simple screen enum
 * (no navigation library needed yet).
 */
import { useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../auth/AuthContext';
import { BanksScreen } from './BanksScreen';
import { ConfigScreen } from './ConfigScreen';
import { StatusScreen } from './StatusScreen';

type Screen = 'home' | 'config' | 'banks' | 'status';

/**
 * Shows the connection summary and routes to the editors.
 * @returns The home screen element.
 */
export function HomeScreen() {
  const { connection, disconnect } = useAuth();
  const [screen, setScreen] = useState<Screen>('home');

  if (screen === 'config') {
    return <ConfigScreen onBack={() => { setScreen('home'); }} />;
  }
  if (screen === 'banks') {
    return <BanksScreen onBack={() => { setScreen('home'); }} />;
  }
  if (screen === 'status') {
    return <StatusScreen onBack={() => { setScreen('home'); }} />;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Connected</Text>
      <Text style={styles.host}>{connection?.baseUrl}</Text>
      <View style={styles.button}>
        <Button title="Edit configuration" onPress={() => { setScreen('config'); }} />
      </View>
      <View style={styles.button}>
        <Button title="Manage banks" onPress={() => { setScreen('banks'); }} />
      </View>
      <View style={styles.button}>
        <Button title="Import status" onPress={() => { setScreen('status'); }} />
      </View>
      <View style={styles.button}>
        <Button title="Disconnect" color="#b00020" onPress={() => { void disconnect(); }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: '600' },
  host: { fontSize: 16, color: '#444' },
  button: { width: 220 },
});
