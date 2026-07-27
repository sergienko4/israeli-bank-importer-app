/**
 * Home dashboard tab: an at-a-glance overview of the connected importer. Above
 * the fold it shows the connection, the last import result, and the number of
 * configured banks in tidy cards that also navigate to the relevant tab. Data
 * loads from the status and config endpoints with skeleton placeholders for a
 * fast first paint. Top-level navigation lives in the bottom tab bar.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { getConfig, getStatus } from '../api/importerClient';
import type { ConfigObject } from '../api/manifest';
import type { RunEntry } from '../api/status';
import { useAuth } from '../auth/AuthContext';
import {
  Button, Card, Entrance, Screen, Skeleton, StatusPill,
} from '../components/ui';
import type { PillTone } from '../components/ui';
import { banksConfigured, latestRun, relativeTime } from '../lib/homeOverview';
import { haptics } from '../lib/haptics';
import { useTheme } from '../theme/ThemeContext';

/** The tabs the Home quick actions can jump to. */
export type HomeTarget = 'config' | 'banks' | 'status';

interface Props {
  /** Switches the active tab (used by the overview cards). */
  onNavigate: (tab: HomeTarget) => void;
}

/**
 * Picks the pill tone for a run from its success ratio.
 * @param run - The run entry.
 * @returns The status pill tone.
 */
function runTone(run: RunEntry): PillTone {
  if (run.successfulBanks >= run.totalBanks) {
    return 'success';
  }
  return run.successfulBanks === 0 ? 'danger' : 'warning';
}

/**
 * Shows the connection summary, last-import result, and banks count.
 * @param props - Callback to switch tabs.
 * @returns The home dashboard element.
 */
export function HomeScreen({ onNavigate }: Props) {
  const theme = useTheme();
  const { connection, disconnect } = useAuth();
  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [config, setConfig] = useState<ConfigObject | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!connection) {
      return undefined;
    }
    let active = true;
    const run = async () => {
      try {
        const [loadedRuns, loadedConfig] = await Promise.all([
          getStatus(connection),
          getConfig(connection),
        ]);
        if (active) {
          setRuns(loadedRuns);
          setConfig(loadedConfig);
          setFailed(false);
        }
      } catch {
        // Overview is best-effort; the dedicated tabs surface real errors.
        if (active) {
          setFailed(true);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    void run();
    return () => { active = false; };
  }, [connection]);

  const last = latestRun(runs);
  const bankCount = config ? banksConfigured(config) : 0;

  return (
    <Screen contentStyle={styles.content}>
      <Entrance>
        <Text style={[theme.typography.small, { color: theme.colors.textMuted }]}>Welcome back</Text>
        <View style={styles.brandRow}>
          <View style={[styles.logo, { backgroundColor: theme.colors.primary, borderRadius: theme.radius.md }]}>
            <Ionicons name="wallet" size={20} color={theme.colors.onPrimary} />
          </View>
          <Text style={[theme.typography.h1, { color: theme.colors.text }]}>Bank Importer</Text>
        </View>
      </Entrance>

      <Entrance index={1}>
        <Card style={styles.connection} elevation={2}>
          <View style={styles.rowBetween}>
            <Text style={[theme.typography.caption, styles.eyebrow, { color: theme.colors.textSubtle }]}>IMPORTER</Text>
            <StatusPill label="Connected" tone="success" />
          </View>
          <Text style={[theme.typography.bodyMedium, { color: theme.colors.text }]} numberOfLines={1}>
            {connection?.baseUrl}
          </Text>
        </Card>
      </Entrance>

      <Text style={[theme.typography.caption, styles.section, { color: theme.colors.textSubtle }]}>OVERVIEW</Text>

      {failed && !loading ? (
        <Text style={[theme.typography.small, styles.overviewNote, { color: theme.colors.textMuted }]}>
          Couldn&apos;t refresh the overview. Open a tab to retry.
        </Text>
      ) : null}

      <Entrance index={2}>
        <Card onPress={() => { onNavigate('status'); }} style={styles.card}>
          <View style={styles.cardHead}>
            <View style={styles.cardTitle}>
              <View style={[styles.bubble, { backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.md }]}>
                <Ionicons name="pulse" size={18} color={theme.colors.primary} />
              </View>
              <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Last import</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.colors.textSubtle} />
          </View>
          {loading ? (
            <View style={styles.loadingLines}>
              <Skeleton width="60%" height={14} />
              <Skeleton width="40%" height={12} />
            </View>
          ) : last ? (
            <View style={styles.rowBetween}>
              <View style={styles.lastText}>
                <Text style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>
                  {`${String(last.successfulBanks)}/${String(last.totalBanks)} banks · ${String(last.totalTransactions)} txns`}
                </Text>
                <Text style={[theme.typography.small, { color: theme.colors.textMuted }]}>
                  {relativeTime(last.timestamp)}
                </Text>
              </View>
              <StatusPill label={`${String(Math.round(last.successRate * 100))}%`} tone={runTone(last)} />
            </View>
          ) : (
            <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>No imports yet.</Text>
          )}
        </Card>
      </Entrance>

      <Entrance index={3}>
        <Card onPress={() => { onNavigate('banks'); }} style={styles.card}>
          <View style={styles.cardHead}>
            <View style={styles.cardTitle}>
              <View style={[styles.bubble, { backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.md }]}>
                <Ionicons name="business" size={18} color={theme.colors.primary} />
              </View>
              <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Banks</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.colors.textSubtle} />
          </View>
          {loading ? (
            <Skeleton width="45%" height={14} style={styles.loadingLines} />
          ) : (
            <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>
              {bankCount === 0 ? 'No banks yet — add your first.' : `${String(bankCount)} configured`}
            </Text>
          )}
        </Card>
      </Entrance>

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
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  logo: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  connection: { gap: 10 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { letterSpacing: 0.6 },
  section: { letterSpacing: 0.6, marginTop: 12, marginLeft: 4 },
  overviewNote: { marginLeft: 4, marginBottom: 4 },
  card: { gap: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bubble: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  lastText: { flex: 1, gap: 2 },
  loadingLines: { gap: 8 },
  disconnect: { marginTop: 16 },
});
