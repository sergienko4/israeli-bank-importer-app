/**
 * Connect screen: a branded landing where the user enters their importer URL and
 * hands off to the portal to sign in. Errors surface in an inline banner.
 * Purely presentational over the auth context.
 */
import { Ionicons } from '@expo/vector-icons';
import { type ReactElement, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../auth/AuthContext';
import { Banner, Button, Card, Screen, TextField } from '../components/ui';
import { haptics } from '../lib/haptics';
import { useTheme } from '../theme/ThemeContext';

/**
 * Renders the connect form and drives the sign-in action.
 * @returns The connect screen element.
 */
export function ConnectScreen(): ReactElement {
  const theme = useTheme();
  const { connect } = useAuth();
  const [baseUrl, setBaseUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onConnect = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await connect(baseUrl);
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
        <View
          style={[
            styles.logo,
            { backgroundColor: theme.colors.primary, borderRadius: theme.radius.xl },
            theme.shadow(2),
          ]}
        >
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
          autoComplete="url"
          textContentType="URL"
        />

        <Text style={[theme.typography.small, { color: theme.colors.textMuted }]}>
          Signing in opens your importer&apos;s own login page in the browser. Your password is
          never entered here.
        </Text>

        {error ? <Banner messages={[error]} tone="danger" /> : null}

        <Button
          title="Sign in"
          icon="arrow-forward"
          loading={busy}
          disabled={!baseUrl}
          onPress={() => {
            void onConnect();
          }}
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
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 44,
  },
  toggleText: { flex: 1, gap: 2 },
  submit: { marginTop: 4 },
  hint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  hintText: { textAlign: 'center' },
});
