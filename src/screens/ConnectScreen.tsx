/**
 * Connect + login screen: a branded landing where the user enters their
 * importer URL and portal password, then connects. Errors surface in an inline
 * banner. Purely presentational over the auth context.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../auth/AuthContext';
import {
  Button, Card, Screen, TextField,
} from '../components/ui';
import { haptics } from '../lib/haptics';
import { useTheme } from '../theme/ThemeContext';

/**
 * Renders the connect form and drives the connect action.
 * @returns The connect screen element.
 */
export function ConnectScreen() {
  const theme = useTheme();
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
      haptics.success();
    } catch (e) {
      haptics.warning();
      setError(e instanceof Error ? e.message : 'Could not connect.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.brand}>
        <View style={[styles.logo, { backgroundColor: theme.colors.primary, borderRadius: theme.radius.xl }, theme.shadow(2)]}>
          <Ionicons name="wallet" size={32} color={theme.colors.onPrimary} />
        </View>
        <Text style={[theme.typography.display, { color: theme.colors.text }]}>Bank Importer</Text>
        <Text style={[theme.typography.body, styles.tagline, { color: theme.colors.textMuted }]}>
          Manage your self-hosted importer from anywhere on your private network.
        </Text>
      </View>

      <Card style={styles.card} elevation={2}>
        <TextField
          label="Importer URL"
          icon="link-outline"
          value={baseUrl}
          onChangeText={setBaseUrl}
          placeholder="https://your-importer:8080"
          keyboardType="url"
        />
        <TextField
          label="Portal password"
          icon="lock-closed-outline"
          secure
          value={password}
          onChangeText={setPassword}
          placeholder="Your portal password"
        />

        {error ? (
          <View style={[styles.banner, { backgroundColor: theme.colors.dangerSoft, borderRadius: theme.radius.md }]}>
            <Ionicons name="alert-circle" size={18} color={theme.colors.danger} />
            <Text style={[theme.typography.small, styles.bannerText, { color: theme.colors.danger }]}>{error}</Text>
          </View>
        ) : null}

        <Button
          title="Connect"
          icon="arrow-forward"
          loading={busy}
          disabled={!baseUrl || !password}
          onPress={() => { void onConnect(); }}
          style={styles.submit}
        />
      </Card>

      <View style={styles.hint}>
        <Ionicons name="shield-checkmark-outline" size={15} color={theme.colors.textSubtle} />
        <Text style={[theme.typography.small, styles.hintText, { color: theme.colors.textSubtle }]}>
          Reachable over your private network (e.g. Tailscale).
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', gap: 24 },
  brand: { alignItems: 'center', gap: 8 },
  logo: { width: 68, height: 68, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  tagline: { textAlign: 'center', maxWidth: 300 },
  card: { gap: 16 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  bannerText: { flex: 1 },
  submit: { marginTop: 4 },
  hint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  hintText: { textAlign: 'center' },
});
