/**
 * Presentational cards for the Home dashboard. Kept out of `HomeScreen` so the
 * screen owns loading and retry, and each card owns what it displays and how it
 * announces that to assistive technology.
 */
import { Ionicons } from '@expo/vector-icons';
import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { RunEntry } from '../api/status';
import type { PillTone } from '../components/ui';
import { Card, Entrance, Skeleton, StatusPill } from '../components/ui';
import { bankCountCardLabel, lastImportCardLabel } from '../lib/a11yLabels';
import { relativeTime, runSummary, successRateLabel } from '../lib/homeOverview';
import { useTheme } from '../theme/ThemeContext';

interface ConnectionCardProps {
  baseUrl?: string;
}

interface LastImportCardProps {
  loading: boolean;
  unavailable: boolean;
  last: RunEntry | null;
  onOpen: () => void;
}

interface BankCountCardProps {
  loading: boolean;
  unavailable: boolean;
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

/**
 * Picks the visible copy for the banks card.
 * @param unavailable - Whether the overview failed with nothing to show.
 * @param bankCount - The configured count.
 * @returns The line under the Banks title.
 */
function bankCountText(unavailable: boolean, bankCount: number): string {
  if (unavailable) {
    return 'Overview unavailable. Try again.';
  }
  if (bankCount === 0) {
    return 'No banks yet — add your first.';
  }
  return `${String(bankCount)} configured`;
}

/**
 * Renders the Home greeting and brand mark.
 * @returns The hero element.
 */
export function HomeHero(): ReactElement {
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
          <Ionicons name="wallet" size={20} color={theme.colors.onPrimary} accessible={false} />
        </View>
        <Text style={[theme.typography.h1, { color: theme.colors.text }]}>Bank Importer</Text>
      </View>
    </Entrance>
  );
}

/**
 * Renders the connected importer address.
 * @param props - The saved base URL.
 * @returns The connection card.
 */
export function ConnectionCard({ baseUrl }: Readonly<ConnectionCardProps>): ReactElement {
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
  unavailable,
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

  if (unavailable) {
    return (
      <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>
        Overview unavailable. Try again.
      </Text>
    );
  }

  if (last) {
    return (
      <View style={styles.rowBetween}>
        <View style={styles.lastText}>
          <Text style={[theme.typography.bodyMedium, { color: theme.colors.text }]}>
            {runSummary(last)}
          </Text>
          <Text style={[theme.typography.small, { color: theme.colors.textMuted }]}>
            {relativeTime(last.timestamp)}
          </Text>
        </View>
        <StatusPill
          label={successRateLabel(last)}
          tone={runTone(last)}
          accessibilityLabel={`${successRateLabel(last)} of banks succeeded`}
        />
      </View>
    );
  }

  return (
    <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>No imports yet.</Text>
  );
}

/**
 * Renders the last-import summary and opens the status tab.
 * @param props - Loading state, failure state, the run, and the open callback.
 * @returns The pressable last-import card.
 */
export function LastImportCard({
  loading,
  unavailable,
  last,
  onOpen,
}: Readonly<LastImportCardProps>): ReactElement {
  const theme = useTheme();
  const summary = last ? runSummary(last) : null;
  const when = last ? relativeTime(last.timestamp) : null;

  return (
    <Entrance index={2}>
      <Card
        accessibilityLabel={lastImportCardLabel({ loading, unavailable, summary, when })}
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
              <Ionicons name="pulse" size={18} color={theme.colors.primary} accessible={false} />
            </View>
            <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Last import</Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={20}
            color={theme.colors.textSubtle}
            accessible={false}
          />
        </View>
        <LastImportBody loading={loading} unavailable={unavailable} last={last} />
      </Card>
    </Entrance>
  );
}

/**
 * Renders the configured-bank count and opens the banks tab.
 * @param props - Loading state, failure state, the count, and the open callback.
 * @returns The pressable bank-count card.
 */
export function BankCountCard({
  loading,
  unavailable,
  bankCount,
  onOpen,
}: Readonly<BankCountCardProps>): ReactElement {
  const theme = useTheme();
  return (
    <Entrance index={3}>
      <Card
        accessibilityLabel={bankCountCardLabel({ loading, count: bankCount, unavailable })}
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
              <Ionicons name="business" size={18} color={theme.colors.primary} accessible={false} />
            </View>
            <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Banks</Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={20}
            color={theme.colors.textSubtle}
            accessible={false}
          />
        </View>
        {loading ? (
          <Skeleton width="45%" height={14} style={styles.loadingLines} />
        ) : (
          <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>
            {bankCountText(unavailable, bankCount)}
          </Text>
        )}
      </Card>
    </Entrance>
  );
}

const styles = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  logo: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  connection: { gap: 10 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { letterSpacing: 0.6 },
  card: { gap: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bubble: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  lastText: { flex: 1, gap: 2 },
  loadingLines: { gap: 8 },
});
