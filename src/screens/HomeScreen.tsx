/**
 * Post-connection home. A placeholder until the config editor (Phase 2) lands;
 * confirms the active connection and offers a disconnect action.
 */
import { Button, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../auth/AuthContext';

/**
 * Shows the active connection and a disconnect action.
 * @returns The home screen element.
 */
export function HomeScreen() {
  const { connection, disconnect } = useAuth();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Connected</Text>
      <Text style={styles.host}>{connection?.baseUrl}</Text>
      <Text style={styles.note}>Config editing arrives in the next update.</Text>
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
  note: { fontSize: 14, color: '#888', textAlign: 'center' },
  button: { marginTop: 8 },
});
