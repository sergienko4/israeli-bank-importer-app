/**
 * Import status screen: shows recent import runs (per-bank outcome + counts)
 * from the importer's redacted audit log, newest first, with pull-to-refresh.
 */
import { Ionicons } from '@expo/vector-icons';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { getStatus } from '../api/importerClient';
import type { RunEntry } from '../api/status';
import { useAuth } from '../auth/AuthContext';
import {
  AppHeader,
  Banner,
  Card,
  Divider,
  EmptyState,
  Entrance,
  ErrorView,
  Screen,
  SkeletonList,
  StatusPill,
} from '../components/ui';
import { bankRunRowLabel, runPillLabel } from '../lib/a11yLabels';
import { failureMessage, reportedOrFallback } from '../lib/errorMessages';
import { runTone } from '../lib/runOutcome';
import type { Theme } from '../theme/ThemeContext';
import { useTheme } from '../theme/ThemeContext';

const UNREACHABLE = failureMessage('unreachable').text;

/**
 * Header action that refreshes without requiring a pull gesture.
 * @param props - The busy flag and refresh callback.
 * @returns The refresh button.
 */
function RefreshButton({
  busy,
  onPress,
}: Readonly<{ busy: boolean; onPress: () => void }>): ReactElement {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Refresh import runs"
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.refresh,
        pressed && !busy
          ? { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.sm }
          : null,
      ]}
    >
      <Ionicons
        name="refresh"
        size={20}
        color={busy ? theme.colors.textSubtle : theme.colors.primary}
        accessible={false}
      />
    </Pressable>
  );
}

/**
 * Renders the status screen's header with its refresh action.
 * @param props - Back, busy, and refresh wiring.
 * @returns The header.
 */
function StatusHeader({
  onBack,
  refreshing,
  onRefresh,
}: Readonly<{ onBack?: () => void; refreshing: boolean; onRefresh: () => void }>): ReactElement {
  return (
    <AppHeader
      title="Import status"
      subtitle="Recent runs"
      onBack={onBack}
      right={<RefreshButton busy={refreshing} onPress={onRefresh} />}
    />
  );
}

/**
 * Renders the run history, or an explanation of why it is empty.
 * @param props - The runs, newest first.
 * @returns The list, or the empty state when there is nothing to show.
 */
function RunList({
  runs,
  onRefresh,
}: Readonly<{ runs: readonly RunEntry[]; onRefresh: () => void }>): ReactElement {
  if (runs.length === 0) {
    return (
      <EmptyState
        icon="pulse-outline"
        title="No runs yet"
        message="Import runs will appear here after the importer scrapes your banks."
        actionLabel="Refresh"
        onAction={onRefresh}
      />
    );
  }
  return (
    <>
      {runs.map((entry, index) => (
        <Entrance key={`run-${String(index)}`} index={index}>
          <RunCard entry={entry} />
        </Entrance>
      ))}
    </>
  );
}

interface Props {
  onBack?: () => void;
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

function bankStatusMeta(
  status: RunEntry['banks'][number]['status'],
  colors: Theme['colors'],
): { color: string; icon: keyof typeof Ionicons.glyphMap } {
  if (status === 'failure') {
    return { color: colors.danger, icon: 'close-circle' };
  }

  if (status === 'success') {
    return { color: colors.success, icon: 'checkmark-circle' };
  }

  return { color: colors.textSubtle, icon: 'ellipse' };
}

/**
 * Renders one import run as a card with its per-bank rows.
 * @param props - The run entry to render.
 * @returns The run card.
 */
function RunCard({ entry }: Readonly<{ entry: RunEntry }>): ReactElement {
  const theme = useTheme();
  return (
    <Card style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>
          {formatTime(entry.timestamp)}
        </Text>
        <StatusPill
          label={`${String(entry.successfulBanks)}/${String(entry.totalBanks)} banks`}
          tone={runTone(entry.totalBanks, entry.successfulBanks)}
          accessibilityLabel={runPillLabel(entry)}
        />
      </View>
      <Text style={[theme.typography.small, { color: theme.colors.textMuted }]}>
        {String(entry.totalTransactions)} transactions imported
      </Text>
      <Divider style={styles.divider} />
      {entry.banks.map((bank, index) => {
        const { color, icon } = bankStatusMeta(bank.status, theme.colors);
        return (
          <View
            key={`${bank.name}-${String(index)}`}
            accessible
            accessibilityLabel={bankRunRowLabel(bank)}
            style={styles.bankRow}
          >
            <View style={styles.bankName}>
              <Ionicons name={icon} size={16} color={color} accessible={false} />
              <Text style={[theme.typography.body, { color: theme.colors.text }]} numberOfLines={2}>
                {bank.name}
              </Text>
            </View>
            <Text style={[theme.typography.small, { color: theme.colors.textMuted }]}>
              {String(bank.txns)} txns
            </Text>
          </View>
        );
      })}
      {entry.banks
        .filter((bank) => bank.error)
        .map((bank, index) => (
          <Text
            key={`err-${String(index)}`}
            style={[theme.typography.small, styles.errorLine, { color: theme.colors.danger }]}
          >
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
export function StatusScreen({ onBack }: Readonly<Props>): ReactElement {
  const theme = useTheme();
  const { connection } = useAuth();
  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!connection) {
      return undefined;
    }
    let active = true;
    const run = async (): Promise<void> => {
      try {
        const loaded = await getStatus(connection);
        if (active) {
          setRuns(loaded);
        }
      } catch (e) {
        if (active) {
          setError(reportedOrFallback(e instanceof Error ? e.message : undefined, UNREACHABLE));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [connection, reloadKey]);

  const reload = (): void => {
    setError(null);
    setRefreshError(null);
    setLoading(true);
    setReloadKey((key) => key + 1);
  };

  const onRefresh = async (): Promise<void> => {
    // A ref, not the refreshing state: two taps in one frame both read the state
    // from the render they came from, so only a ref stops the second request.
    if (!connection || inFlight.current) {
      return;
    }
    inFlight.current = true;
    setRefreshing(true);
    try {
      setRuns(await getStatus(connection));
      setError(null);
      setRefreshError(null);
    } catch (e) {
      setRefreshError(reportedOrFallback(e instanceof Error ? e.message : undefined, UNREACHABLE));
    } finally {
      inFlight.current = false;
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
      header={
        <StatusHeader
          onBack={onBack}
          refreshing={refreshing}
          onRefresh={() => {
            void onRefresh();
          }}
        />
      }
      contentStyle={styles.list}
      notice={
        refreshError === null ? undefined : (
          <Banner
            messages={[refreshError]}
            action={{
              label: 'Try again',
              onPress: () => {
                void onRefresh();
              },
            }}
          />
        )
      }
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            void onRefresh();
          }}
          tintColor={theme.colors.primary}
          colors={[theme.colors.primary]}
        />
      }
    >
      <RunList
        runs={ordered}
        onRefresh={() => {
          void onRefresh();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  card: { gap: 6 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  divider: { marginVertical: 6 },
  bankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 5,
  },
  bankName: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, marginRight: 8 },
  errorLine: { marginTop: 6 },
  refresh: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
});
