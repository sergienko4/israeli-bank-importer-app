/**
 * Import status screen: shows recent import runs (per-bank outcome + counts)
 * from the importer's redacted audit log, newest first, with pull-to-refresh.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  RefreshControl, StyleSheet, Text, View,
} from 'react-native';

import { getStatus } from '../api/importerClient';
import type { RunEntry } from '../api/status';
import { useAuth } from '../auth/AuthContext';
import {
  AppHeader, Card, Divider, EmptyState, Entrance, ErrorView, Screen, SkeletonList, StatusPill,
} from '../components/ui';
import type { PillTone } from '../components/ui';
import { useTheme } from '../theme/ThemeContext';

interface Props {
  onBack: () => void;
}

/**
 * Formats an ISO timestamp for display, falling back to the raw value.
 * @param iso - The ISO timestamp.
 * @returns A locale date-time string.
 */
function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/**
 * Picks the overall run tone from its success ratio.
 * @param entry - The run entry.
 * @returns The pill tone.
 */
function runTone(entry: RunEntry): PillTone {
  if (entry.successfulBanks >= entry.totalBanks) {
    return 'success';
  }
  return entry.successfulBanks === 0 ? 'danger' : 'warning';
}

/**
 * Renders one import run as a card with its per-bank rows.
 * @param props - The run entry to render.
 * @returns The run card.
 */
function RunCard({ entry }: { entry: RunEntry }) {
  const theme = useTheme();
  return (
    <Card style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>{formatTime(entry.timestamp)}</Text>
        <StatusPill
          label={`${String(entry.successfulBanks)}/${String(entry.totalBanks)}`}
          tone={runTone(entry)}
        />
      </View>
      <Text style={[theme.typography.small, { color: theme.colors.textMuted }]}>
        {String(entry.totalTransactions)} transactions imported
      </Text>
      <Divider style={styles.divider} />
      {entry.banks.map((bank, index) => {
        const failed = bank.status === 'failure';
        const ok = bank.status === 'success';
        const color = failed ? theme.colors.danger : ok ? theme.colors.success : theme.colors.textSubtle;
        const icon = failed ? 'close-circle' : ok ? 'checkmark-circle' : 'ellipse';
        return (
          <View key={`${bank.name}-${String(index)}`} style={styles.bankRow}>
            <View style={styles.bankName}>
              <Ionicons name={icon} size={16} color={color} />
              <Text style={[theme.typography.body, { color: theme.colors.text }]} numberOfLines={1}>{bank.name}</Text>
            </View>
            <Text style={[theme.typography.small, { color: theme.colors.textMuted }]}>{String(bank.txns)} txns</Text>
          </View>
        );
      })}
      {entry.banks.filter((bank) => bank.error).map((bank, index) => (
        <Text key={`err-${String(index)}`} style={[theme.typography.small, styles.errorLine, { color: theme.colors.danger }]}>
          {bank.name}: {bank.error}
        </Text>
      ))}
    </Card>
  );
}

/**
 * Renders the import status screen.
 * @param props - Callback to return to the home screen.
 * @returns The status screen element.
 */
export function StatusScreen({ onBack }: Props) {
  const theme = useTheme();
  const { connection } = useAuth();
  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!connection) {
      return undefined;
    }
    let active = true;
    const run = async () => {
      try {
        const loaded = await getStatus(connection);
        if (active) {
          setRuns(loaded);
        }
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : 'Failed to load status.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    void run();
    return () => { active = false; };
  }, [connection, reloadKey]);

  const reload = () => {
    setError(null);
    setLoading(true);
    setReloadKey((key) => key + 1);
  };

  const onRefresh = async (): Promise<void> => {
    if (!connection) {
      return;
    }
    setRefreshing(true);
    try {
      setRuns(await getStatus(connection));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load status.');
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <Screen header={<AppHeader title="Import status" onBack={onBack} />}>
        <SkeletonList count={3} />
      </Screen>
    );
  }
  if (error) {
    return (
      <Screen scroll={false} header={<AppHeader title="Import status" onBack={onBack} />}>
        <ErrorView message={error} onRetry={reload} />
      </Screen>
    );
  }

  const ordered = [...runs].reverse();

  return (
    <Screen
      header={<AppHeader title="Import status" subtitle="Recent runs" onBack={onBack} />}
      contentStyle={styles.list}
      refreshControl={(
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { void onRefresh(); }}
          tintColor={theme.colors.primary}
          colors={[theme.colors.primary]}
        />
      )}
    >
      {ordered.length === 0 ? (
        <EmptyState
          icon="pulse-outline"
          title="No runs yet"
          message="Import runs will appear here after the importer scrapes your banks. Pull down to refresh."
        />
      ) : (
        ordered.map((entry, index) => (
          <Entrance key={`run-${String(index)}`} index={index}>
            <RunCard entry={entry} />
          </Entrance>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  card: { gap: 6 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  divider: { marginVertical: 6 },
  bankRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5 },
  bankName: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, marginRight: 8 },
  errorLine: { marginTop: 6 },
});
