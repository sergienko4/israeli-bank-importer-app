/**
 * Post-connection home: confirms the active connection and offers entry to the
 * config editor plus a disconnect action. Navigation is a simple screen toggle
 * (no navigation library needed yet).
 */
import { useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../auth/AuthContext';
import { ConfigScreen } from './ConfigScreen';

/**
 * Shows the connection summary and navigates to the config editor.
 * @returns The home screen element.
 */
export function HomeScreen() {
  const { connection, disconnect } = useAuth();
  const [editing, setEditing] = useState(false);

  if (editing) {
    return <ConfigScreen onBack={() => { setEditing(false); }} />;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Connected</Text>
      <Text style={styles.host}>{connection?.baseUrl}</Text>
      <View style={styles.button}>
        <Button title="Edit configuration" onPress={() => { setEditing(true); }} />
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
