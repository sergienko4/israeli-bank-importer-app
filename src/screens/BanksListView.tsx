/**
 * Bank catalog and configured-bank list for the banks screen.
 */
import { Ionicons } from '@expo/vector-icons';
import type { ReactElement } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import {
  AppHeader,
  Banner,
  Card,
  Divider,
  EmptyState,
  Entrance,
  ListRow,
  Screen,
  SectionLabel,
} from '../components/ui';
import { targetsLabel } from '../lib/bankDrafts';
import { useTheme } from '../theme/ThemeContext';
import { type BankConfig, targetsOf } from './BanksScreenModel';

interface BanksListViewProps {
  banks: Record<string, BankConfig>;
  configuredIds: string[];
  catalog: string[];
  nameOf: (id: string) => string;
  saveErrors: string[] | null;
  removing: boolean;
  onSelect: (id: string) => void;
  onStartAdd: (id: string) => void;
  onRemove: (id: string) => void;
}

/**
 * Picks the list notice for a delete or a failed delete.
 * @param removing - Whether a bank delete is in flight.
 * @param saveErrors - Delete failures to show, or null.
 * @returns The banner, or undefined when there is nothing to say.
 */
function listNotice(removing: boolean, saveErrors: string[] | null): ReactElement | undefined {
  if (removing) {
    return <Banner messages={['Removing the bank…']} tone="info" />;
  }
  return saveErrors?.length ? <Banner messages={saveErrors} /> : undefined;
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
  saveErrors,
  removing,
  onSelect,
  onStartAdd,
  onRemove,
}: Readonly<BanksListViewProps>): ReactElement {
  const theme = useTheme();
  const notice = listNotice(removing, saveErrors);

  return (
    <Screen header={<AppHeader title="Banks" />} notice={notice}>
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
          <SectionLabel style={styles.sectionLabel}>YOUR BANKS</SectionLabel>
          <Card padded={false} style={styles.menu}>
            {configuredIds.map((id, index) => (
              <Entrance key={id} index={index}>
                <ListRow
                  icon="business"
                  title={nameOf(id)}
                  subtitle={targetsLabel(targetsOf(banks[id] ?? {}).length)}
                  onPress={() => {
                    onSelect(id);
                  }}
                  trailing={
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${nameOf(id)}`}
                      onPress={() => {
                        onRemove(id);
                      }}
                      style={styles.iconBtn}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={20}
                        color={theme.colors.danger}
                        accessible={false}
                      />
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
          <SectionLabel style={[styles.sectionLabel, styles.addLabel]}>ADD A BANK</SectionLabel>
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
  sectionLabel: { marginBottom: 8, marginLeft: 4 },
  addLabel: { marginTop: 20 },
  iconBtn: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
});
