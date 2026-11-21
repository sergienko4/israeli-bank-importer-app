/**
 * Configuration section picker: the manifest's editable sections plus the
 * device-only OTP delivery screen.
 */
import type { ReactElement } from 'react';
import { StyleSheet, Text } from 'react-native';

import type { SectionDef } from '../api/manifest';
import {
  AppHeader,
  Card,
  Divider,
  Entrance,
  ListRow,
  Screen,
  SectionLabel,
} from '../components/ui';
import { haptics } from '../lib/haptics';
import { useTheme } from '../theme/ThemeContext';

interface ConfigSectionListProps {
  sections: SectionDef[];
  onSelect: (section: SectionDef) => void;
  onShowOtp: () => void;
}

/**
 * Renders the configuration section menu.
 * @param props - The sections and the two navigation callbacks.
 * @returns The section list screen.
 */
export function ConfigSectionList({
  sections,
  onSelect,
  onShowOtp,
}: Readonly<ConfigSectionListProps>): ReactElement {
  const theme = useTheme();

  return (
    <Screen header={<AppHeader title="Configuration" />}>
      <Text style={[theme.typography.small, styles.hint, { color: theme.colors.textMuted }]}>
        Choose a section to edit.
      </Text>
      <Card padded={false} style={styles.menu}>
        {sections.map((section, index) => (
          <Entrance key={section.key} index={index}>
            <ListRow
              title={section.label}
              emoji={section.icon}
              icon={section.icon ? undefined : 'cube-outline'}
              onPress={() => {
                haptics.selection();
                onSelect(section);
              }}
            />
            {index < sections.length - 1 ? <Divider style={styles.indent} /> : null}
          </Entrance>
        ))}
      </Card>

      <SectionLabel style={styles.sectionLabel}>DEVICE</SectionLabel>
      <Card padded={false} style={styles.menu}>
        <ListRow
          icon="key-outline"
          title="OTP delivery"
          subtitle="Collect bank codes in this app or via Telegram"
          onPress={() => {
            haptics.selection();
            onShowOtp();
          }}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { marginBottom: 12, marginLeft: 4 },
  sectionLabel: { marginTop: 20, marginBottom: 8, marginLeft: 4 },
  menu: { overflow: 'hidden' },
  indent: { marginLeft: 68 },
});
