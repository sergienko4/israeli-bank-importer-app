/**
 * Selected-bank editor view for credentials, targets, and optional fields.
 */
import { type ReactElement, useEffect } from 'react';
import { BackHandler, ScrollView, StyleSheet } from 'react-native';

import type { FieldDef } from '../api/manifest';
import { FieldInput } from '../components/FieldInput';
import {
  AppHeader,
  Banner,
  Button,
  Card,
  ListRow,
  Screen,
  SectionLabel,
  Sheet,
} from '../components/ui';
import { useGuardedBack, useInvalidFields } from '../lib/useInvalidFields';
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
  const { invalid, report, guard } = useInvalidFields();
  const back = useGuardedBack(invalid, onBack);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => {
      sub.remove();
    };
  }, [back]);

  return (
    <Screen
      header={
        <AppHeader
          title={bankName}
          subtitle="Credentials & targets"
          onBack={back}
          backDisabled={saving}
        />
      }
      notice={saveErrors?.length ? <Banner messages={saveErrors} /> : undefined}
      footer={
        <Button
          title="Save changes"
          icon="checkmark"
          loading={saving}
          onPress={() => {
            guard(onSave);
          }}
        />
      }
    >
      <SectionLabel style={styles.sectionLabel}>CREDENTIALS</SectionLabel>
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
              onValidityChange={report}
              validityKey={field.key}
              disabled={saving}
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
      <BanksTargetsEditor
        fields={targetFields}
        targets={targets}
        onChange={onTargetsChange}
        onValidityChange={report}
        disabled={saving}
      />

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
  sectionLabel: { marginBottom: 8, marginLeft: 4 },
  addField: { marginTop: 8 },
});
