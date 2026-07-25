/**
 * Import status screen: shows recent import runs (per-bank outcome + counts)
 * from the importer's redacted audit log, newest first, with pull-to-refresh.
 */
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Button, ScrollView, StyleSheet, Text, View,
} from 'react-native';

import { getStatus } from '../api/importerClient';
import type { RunEntry } from '../api/status';
import { useAuth } from '../auth/AuthContext';

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
 * Maps a bank status to a compact status glyph.
 * @param status - The per-bank status.
 * @returns A glyph representing the status.
 */
function statusIcon(status: string): string {
  if (status === 'success') {
    return '✓';
  }
  return status === 'failure' ? '✗' : '•';
}

/**
 * Renders one import run as a card with its per-bank rows.
 * @param props - The run entry to render.
 * @returns The run card.
 */
function RunCard({ entry }: { entry: RunEntry }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{formatTime(entry.timestamp)}</Text>
      <Text style={styles.summary}>
        {String(entry.successfulBanks)}/{String(entry.totalBanks)} banks · {String(entry.totalTransactions)} txns
      </Text>
      {entry.banks.map((bank, index) => (
        <View key={`${bank.name}-${String(index)}`} style={styles.bankRow}>
          <Text style={[styles.bankName, bank.status === 'failure' ? styles.fail : styles.ok]}>
            {statusIcon(bank.status)} {bank.name}
          </Text>
          <Text style={styles.txns}>{String(bank.txns)} txns</Text>
        </View>
      ))}
      {entry.banks.filter((bank) => bank.error).map((bank, index) => (
        <Text key={`err-${String(index)}`} style={styles.errorLine}>{bank.name}: {bank.error}</Text>
      ))}
    </View>
  );
}

/**
 * Renders the import status screen.
 * @param props - Callback to return to the home screen.
 * @returns The status screen element.
 */
export function StatusScreen({ onBack }: Props) {
  const { connection } = useAuth();
  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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

  if (loading) {
    return <View style={styles.center}><ActivityIndicator /></View>;
  }
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorLine}>{error}</Text>
        <Button title="Retry" onPress={reload} />
        <Button title="Back" onPress={onBack} />
      </View>
    );
  }

  const ordered = [...runs].reverse();

  return (
    <ScrollView contentContainerStyle={styles.list}>
      <Text style={styles.title}>Import status</Text>
      {ordered.length === 0 ? <Text style={styles.help}>No import runs recorded yet.</Text> : null}
      {ordered.map((entry, index) => <RunCard key={`run-${String(index)}`} entry={entry} />)}
      <View style={styles.actions}>
        <Button title="Refresh" onPress={reload} />
        <Button title="Back" color="#666" onPress={onBack} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, padding: 24 },
  list: { padding: 20, gap: 12 },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 8 },
  help: { fontSize: 13, color: '#888' },
  card: { borderWidth: 1, borderColor: '#eee', borderRadius: 10, padding: 14, backgroundColor: '#fafafa' },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#222' },
  summary: { fontSize: 13, color: '#666', marginTop: 2, marginBottom: 8 },
  bankRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  bankName: { fontSize: 15 },
  ok: { color: '#1a7f37' },
  fail: { color: '#b00020' },
  txns: { fontSize: 13, color: '#666' },
  errorLine: { color: '#b00020', marginTop: 6, fontSize: 13 },
  actions: { marginTop: 12, gap: 8 },
});
