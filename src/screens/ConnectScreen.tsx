/**
 * Connect + login screen: the user enters their importer URL and portal
 * password, then connects. A friendly error is shown on failure.
 */
import { useState } from 'react';
import {
  ActivityIndicator, Button, StyleSheet, Text, TextInput, View,
} from 'react-native';

import { useAuth } from '../auth/AuthContext';

/**
 * Renders the connect form and drives the connect action.
 * @returns The connect screen element.
 */
export function ConnectScreen() {
  const { connect } = useAuth();
  const [baseUrl, setBaseUrl] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onConnect = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await connect(baseUrl, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Connect to your importer</Text>
      <Text style={styles.help}>
        Enter the address of your self-hosted importer (reachable over your private
        network, e.g. Tailscale) and your portal password.
      </Text>

      <Text style={styles.label}>Importer URL</Text>
      <TextInput
        style={styles.input}
        placeholder="http://100.x.x.x:8080"
        placeholderTextColor="#999"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        value={baseUrl}
        onChangeText={setBaseUrl}
      />

      <Text style={styles.label}>Portal password</Text>
      <TextInput
        style={styles.input}
        placeholder="Portal password"
        placeholderTextColor="#999"
        secureTextEntry
        autoCapitalize="none"
        value={password}
        onChangeText={setPassword}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {busy ? (
        <ActivityIndicator style={styles.spinner} />
      ) : (
        <View style={styles.button}>
          <Button title="Connect" onPress={() => { void onConnect(); }} disabled={!baseUrl || !password} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 8 },
  title: { fontSize: 22, fontWeight: '600', textAlign: 'center' },
  help: { fontSize: 13, color: '#666', textAlign: 'center', marginBottom: 12 },
  label: { fontSize: 14, color: '#444', marginTop: 8 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16 },
  error: { color: '#b00020', marginTop: 8 },
  spinner: { marginTop: 16 },
  button: { marginTop: 16 },
});
