/**
 * Bank catalog and configured-bank list for the banks screen.
 */
import { Ionicons } from '@expo/vector-icons';
import type { ReactElement } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { AppHeader, Card, Divider, EmptyState, Entrance, ListRow, Screen } from '../components/ui';
import { useTheme } from '../theme/ThemeContext';
import { type BankConfig, targetsOf } from './BanksScreenModel';

interface BanksListViewProps {
  banks: Record<string, BankConfig>;
  configuredIds: string[];
  catalog: string[];
  nameOf: (id: string) => string;
  onSelect: (id: string) => void;
  onStartAdd: (id: string) => void;
  onRemove: (id: string) => void;
}

/**
 * Renders configured banks and addable bank catalog entries.
 * @param props - Bank maps, catalog ids, display resolver, and callbacks.
 * @returns The bank list screen.
 */
export function BanksListView({
  banks,
  configuredIds,
  catalog,
  nameOf,
  onSelect,
  onStartAdd,
  onRemove,
}: Readonly<BanksListViewProps>): ReactElement {
  const theme = useTheme();

  return (
    <Screen header={<AppHeader title="Banks" />}>
      {configuredIds.length === 0 ? (
        <Entrance>
          <EmptyState
            icon="business-outline"
            title="No banks yet"
            message="Add your first bank below to start importing transactions."
          />
        </Entrance>
      ) : (
        <>
          <Text
            style={[
              theme.typography.caption,
              styles.sectionLabel,
              { color: theme.colors.textSubtle },
            ]}
          >
            YOUR BANKS
          </Text>
          <Card padded={false} style={styles.menu}>
            {configuredIds.map((id, index) => (
              <Entrance key={id} index={index}>
                <ListRow
                  icon="business"
                  title={nameOf(id)}
                  subtitle={`${String(targetsOf(banks[id] ?? {}).length)} target(s)`}
                  onPress={() => {
                    onSelect(id);
                  }}
                  right={
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${nameOf(id)}`}
                      onPress={() => {
                        onRemove(id);
                      }}
                      style={styles.iconBtn}
                    >
                      <Ionicons name="trash-outline" size={20} color={theme.colors.danger} />
                    </Pressable>
                  }
                />
                {index < configuredIds.length - 1 ? <Divider style={styles.indent} /> : null}
              </Entrance>
            ))}
          </Card>
        </>
      )}

      {catalog.length > 0 ? (
        <>
          <Text
            style={[
              theme.typography.caption,
              styles.sectionLabel,
              styles.addLabel,
              { color: theme.colors.textSubtle },
            ]}
          >
            ADD A BANK
          </Text>
          <Card padded={false} style={styles.menu}>
            {catalog.map((id, index) => (
              <Entrance key={id} index={index}>
                <ListRow
                  icon="add-circle-outline"
                  title={nameOf(id)}
                  onPress={() => {
                    onStartAdd(id);
                  }}
                />
                {index < catalog.length - 1 ? <Divider style={styles.indent} /> : null}
              </Entrance>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  menu: { overflow: 'hidden' },
  indent: { marginLeft: 68 },
  sectionLabel: { letterSpacing: 0.6, marginBottom: 8, marginLeft: 4 },
  addLabel: { marginTop: 20 },
  iconBtn: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
});
