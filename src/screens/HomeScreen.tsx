/**
 * Home dashboard tab: an at-a-glance overview of the connected importer. Above
 * the fold it shows the connection, the last import result, and the number of
 * configured banks in tidy cards that also navigate to the relevant tab. Data
 * loads from the status and config endpoints with skeleton placeholders for a
 * fast first paint. Top-level navigation lives in the bottom tab bar.
 */
import { Ionicons } from '@expo/vector-icons';
import { type ReactElement, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { getConfig, getStatus } from '../api/importerClient';
import type { ConfigObject } from '../api/manifest';
import type { RunEntry } from '../api/status';
import { useAuth } from '../auth/AuthContext';
import type { PillTone } from '../components/ui';
import { Banner, Button, Card, Entrance, Screen, Skeleton, StatusPill } from '../components/ui';
import { haptics } from '../lib/haptics';
import { banksConfigured, latestRun, relativeTime } from '../lib/homeOverview';
import { isOverviewTimeout, withOverviewTimeout } from '../lib/overviewTimeout';
import { useTheme } from '../theme/ThemeContext';

/** The tabs the Home quick actions can jump to. */
export type HomeTarget = 'config' | 'banks' | 'status';

interface Props {
  /** Switches the active tab (used by the overview cards). */
  onNavigate: (tab: HomeTarget) => void;
}

interface ConnectionCardProps {
  baseUrl?: string;
}

interface LastImportCardProps {
  loading: boolean;
  last: RunEntry | null;
  onOpen: () => void;
}

interface BankCountCardProps {
  loading: boolean;
  bankCount: number;
  onOpen: () => void;
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

function HomeHero(): ReactElement {
  const theme = useTheme();

  return (
    <Entrance>
      <Text style={[theme.typography.small, { color: theme.colors.textMuted }]}>Welcome back</Text>
      <View style={styles.brandRow}>
        <View
          style={[
            styles.logo,
            { backgroundColor: theme.colors.primary, borderRadius: theme.radius.md },
          ]}
        >
          <Ionicons name="wallet" size={20} color={theme.colors.onPrimary} />
        </View>
        <Text style={[theme.typography.h1, { color: theme.colors.text }]}>Bank Importer</Text>
      </View>
    </Entrance>
  );
}

function ConnectionCard({ baseUrl }: Readonly<ConnectionCardProps>): ReactElement {
  const theme = useTheme();

  return (
    <Entrance index={1}>
      <Card style={styles.connection} elevation={2}>
        <View style={styles.rowBetween}>
          <Text
            style={[theme.typography.caption, styles.eyebrow, { color: theme.colors.textSubtle }]}
          >
            IMPORTER
          </Text>
          <StatusPill label="Connected" tone="success" />
        </View>
        <Text style={[theme.typography.bodyMedium, { color: theme.colors.text }]} numberOfLines={1}>
          {baseUrl}
        </Text>
      </Card>
    </Entrance>
  );
}

function LastImportBody({
  loading,
  last,
}: Readonly<Omit<LastImportCardProps, 'onOpen'>>): ReactElement {
  const theme = useTheme();

  if (loading) {
    return (
      <View style={styles.loadingLines}>
        <Skeleton width="60%" height={14} />
        <Skeleton width="40%" height={12} />
      </View>
    );
  }

  if (last) {
    const summary = `${String(last.successfulBanks)}/${String(last.totalBanks)} banks · ${String(
      last.totalTransactions,
    )} txns`;

    return (
      <View style={styles.rowBetween}>
        <View style={styles.lastText}>
          <Text style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>{summary}</Text>
          <Text style={[theme.typography.small, { color: theme.colors.textMuted }]}>
            {relativeTime(last.timestamp)}
          </Text>
        </View>
        <StatusPill label={`${String(Math.round(last.successRate * 100))}%`} tone={runTone(last)} />
      </View>
    );
  }

  return (
    <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>No imports yet.</Text>
  );
}

function LastImportCard({ loading, last, onOpen }: Readonly<LastImportCardProps>): ReactElement {
  const theme = useTheme();

  return (
    <Entrance index={2}>
      <Card
        accessibilityLabel="Open import status"
        accessibilityHint="Shows recent importer runs and per-bank results."
        onPress={onOpen}
        style={styles.card}
      >
        <View style={styles.cardHead}>
          <View style={styles.cardTitle}>
            <View
              style={[
                styles.bubble,
                { backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.md },
              ]}
            >
              <Ionicons name="pulse" size={18} color={theme.colors.primary} />
            </View>
            <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Last import</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.textSubtle} />
        </View>
        <LastImportBody loading={loading} last={last} />
      </Card>
    </Entrance>
  );
}

function BankCountCard({ loading, bankCount, onOpen }: Readonly<BankCountCardProps>): ReactElement {
  const theme = useTheme();

  return (
    <Entrance index={3}>
      <Card
        accessibilityLabel="Open bank settings"
        accessibilityHint="Shows configured banks and bank credential settings."
        onPress={onOpen}
        style={styles.card}
      >
        <View style={styles.cardHead}>
          <View style={styles.cardTitle}>
            <View
              style={[
                styles.bubble,
                { backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.md },
              ]}
            >
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
  );
}
/**
 * Shows the connection summary, last-import result, and banks count.
 * @param props - Callback to switch tabs.
 * @returns The home dashboard element.
 */
export function HomeScreen({ onNavigate }: Readonly<Props>): ReactElement {
  const theme = useTheme();
  const { connection, disconnect } = useAuth();
  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [config, setConfig] = useState<ConfigObject | null>(null);
  const [loading, setLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  useEffect(() => {
    if (!connection) {
      return undefined;
    }
    let active = true;
    const run = async (): Promise<void> => {
      try {
        const [loadedRuns, loadedConfig] = await withOverviewTimeout(
          Promise.all([getStatus(connection), getConfig(connection)]),
        );
        if (active) {
          setRuns(loadedRuns);
          setConfig(loadedConfig);
          setOverviewError(null);
        }
      } catch (error: unknown) {
        if (active) {
          setOverviewError(
            isOverviewTimeout(error)
              ? 'Overview refresh timed out. Open a tab to retry.'
              : 'Couldn’t refresh the overview. Open a tab to retry.',
          );
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
  }, [connection]);

  const last = latestRun(runs);
  const bankCount = config ? banksConfigured(config) : 0;
  const confirmDisconnect = (): void => {
    Alert.alert('Disconnect importer?', 'This removes the saved connection from this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: () => {
          haptics.medium();
          void disconnect().catch(() => {
            haptics.warning();
            Alert.alert(
              'Could not disconnect',
              'The saved connection is still on this device. Try again.',
            );
          });
        },
      },
    ]);
  };

  return (
    <Screen contentStyle={styles.content}>
      <HomeHero />
      <ConnectionCard baseUrl={connection?.baseUrl} />

      <Text style={[theme.typography.caption, styles.section, { color: theme.colors.textSubtle }]}>
        OVERVIEW
      </Text>

      {overviewError && !loading ? (
        <View style={styles.overviewNote}>
          <Banner messages={[overviewError]} tone="warning" />
        </View>
      ) : null}

      <LastImportCard
        loading={loading}
        last={last}
        onOpen={() => {
          onNavigate('status');
        }}
      />
      <BankCountCard
        loading={loading}
        bankCount={bankCount}
        onOpen={() => {
          onNavigate('banks');
        }}
      />

      <Button
        title="Disconnect"
        icon="log-out-outline"
        variant="secondary"
        onPress={confirmDisconnect}
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
  overviewNote: { marginBottom: 4 },
  card: { gap: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bubble: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  lastText: { flex: 1, gap: 2 },
  loadingLines: { gap: 8 },
  disconnect: { marginTop: 16 },
});
