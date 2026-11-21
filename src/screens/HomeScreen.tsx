/**
 * Home dashboard tab: an at-a-glance overview of the connected importer. Above
 * the fold it shows the connection, the last import result, and the number of
 * configured banks in tidy cards that also navigate to the relevant tab. Data
 * loads from the status and config endpoints with skeleton placeholders for a
 * fast first paint. Top-level navigation lives in the bottom tab bar.
 */
import { type ReactElement, useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { getConfig, getStatus } from '../api/importerClient';
import type { ConfigObject } from '../api/manifest';
import type { RunEntry } from '../api/status';
import { useAuth } from '../auth/AuthContext';
import { Banner, Button, Screen, SectionLabel } from '../components/ui';
import { haptics } from '../lib/haptics';
import { banksConfigured, latestRun } from '../lib/homeOverview';
import { isOverviewTimeout, withOverviewTimeout } from '../lib/overviewTimeout';
import { BankCountCard, ConnectionCard, HomeHero, LastImportCard } from './HomeCards';

/** The tabs the Home quick actions can jump to. */
export type HomeTarget = 'config' | 'banks' | 'status';

interface Props {
  /** Switches the active tab (used by the overview cards). */
  onNavigate: (tab: HomeTarget) => void;
}

/**
 * Shows the connection summary, last-import result, and banks count.
 * @param props - Callback to switch tabs.
 * @returns The home dashboard element.
 */
export function HomeScreen({ onNavigate }: Readonly<Props>): ReactElement {
  const { connection, disconnect } = useAuth();
  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [config, setConfig] = useState<ConfigObject | null>(null);
  const [loading, setLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

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
              ? 'Overview refresh timed out.'
              : 'Couldn’t refresh the overview.',
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
  }, [connection, reloadKey]);

  const reload = (): void => {
    setOverviewError(null);
    setLoading(true);
    setReloadKey((key) => key + 1);
  };

  const last = latestRun(runs);
  const bankCount = config ? banksConfigured(config) : 0;
  // Keep stale data visible when only the refresh failed; report "unavailable"
  // only when there is nothing to show, so a failed retry does not blank a
  // dashboard the user could still act on.
  const unavailable = overviewError !== null && config === null;
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

      <SectionLabel style={styles.section}>OVERVIEW</SectionLabel>

      {overviewError && !loading ? (
        <View style={styles.overviewNote}>
          <Banner
            messages={[overviewError]}
            tone="warning"
            action={{ label: 'Try again', onPress: reload }}
          />
        </View>
      ) : null}

      <LastImportCard
        loading={loading}
        unavailable={unavailable}
        last={last}
        onOpen={() => {
          onNavigate('status');
        }}
      />
      <BankCountCard
        loading={loading}
        unavailable={unavailable}
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
  section: { marginTop: 12, marginLeft: 4 },
  overviewNote: { marginBottom: 4 },
  disconnect: { marginTop: 16 },
});
