/**
 * Selected-bank editor view for credentials, targets, and optional fields.
 */
import type { ReactElement } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import type { FieldDef } from '../api/manifest';
import { FieldInput } from '../components/FieldInput';
import { AppHeader, Banner, Button, Card, ListRow, Screen, Sheet } from '../components/ui';
import { useTheme } from '../theme/ThemeContext';
import { BanksTargetsEditor } from './BanksTargetsEditor';

type BankConfig = Record<string, unknown>;
type TargetConfig = Record<string, unknown>;

interface BanksEditorViewProps {
  bankName: string;
  bank: BankConfig;
  presentFields: FieldDef[];
  missingFields: FieldDef[];
  requiredKeys: Set<string>;
  targetFields: FieldDef[];
  targets: TargetConfig[];
  saving: boolean;
  saveErrors: string[] | null;
  sheetOpen: boolean;
  onBack: () => void;
  onSave: () => void;
  onFieldChange: (key: string, value: unknown) => void;
  onFieldRemove: (key: string) => void;
  onTargetsChange: (targets: TargetConfig[]) => void;
  onOpenSheet: () => void;
  onCloseSheet: () => void;
  onAddField: (field: FieldDef) => void;
}

/**
 * Renders the selected bank editor.
 * @param props - Selected bank data, state flags, and editor callbacks.
 * @returns The selected bank editor screen.
 */
export function BanksEditorView({
  bankName,
  bank,
  presentFields,
  missingFields,
  requiredKeys,
  targetFields,
  targets,
  saving,
  saveErrors,
  sheetOpen,
  onBack,
  onSave,
  onFieldChange,
  onFieldRemove,
  onTargetsChange,
  onOpenSheet,
  onCloseSheet,
  onAddField,
}: Readonly<BanksEditorViewProps>): ReactElement {
  const theme = useTheme();

  return (
    <Screen
      header={<AppHeader title={bankName} subtitle="Credentials & targets" onBack={onBack} />}
      notice={saveErrors?.length ? <Banner messages={saveErrors} /> : undefined}
      footer={<Button title="Save changes" icon="checkmark" loading={saving} onPress={onSave} />}
    >
      <Text
        style={[theme.typography.caption, styles.sectionLabel, { color: theme.colors.textSubtle }]}
      >
        CREDENTIALS
      </Text>
      <Card>
        {presentFields.map((field) => {
          const isRequired = requiredKeys.has(field.key);
          return (
            <FieldInput
              key={field.key}
              field={{ ...field, required: isRequired }}
              value={bank[field.key]}
              onChange={(value) => {
                onFieldChange(field.key, value);
              }}
              onRemove={
                isRequired
                  ? undefined
                  : () => {
                      onFieldRemove(field.key);
                    }
              }
            />
          );
        })}
        {missingFields.length > 0 ? (
          <Button
            title="Add field"
            variant="secondary"
            size="sm"
            icon="add"
            fullWidth={false}
            onPress={onOpenSheet}
            style={styles.addField}
          />
        ) : null}
      </Card>
      <BanksTargetsEditor fields={targetFields} targets={targets} onChange={onTargetsChange} />

      <Sheet visible={sheetOpen} onClose={onCloseSheet} title="Add a field">
        <ScrollView>
          {missingFields.map((field) => (
            <ListRow
              key={field.key}
              icon="add-circle-outline"
              title={field.label}
              subtitle={field.help}
              onPress={() => {
                onAddField(field);
              }}
            />
          ))}
        </ScrollView>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { letterSpacing: 0.6, marginBottom: 8, marginLeft: 4 },
  addField: { marginTop: 8 },
});
