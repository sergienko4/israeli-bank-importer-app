/**
 * Per-target bank editor rows for the bank configuration screen.
 */
import type { ReactElement } from 'react';
import { Keyboard, StyleSheet, Text, View } from 'react-native';

import type { FieldDef } from '../api/manifest';
import { FieldInput } from '../components/FieldInput';
import { Button, Card, SectionLabel } from '../components/ui';
import { animateNextLayout } from '../lib/layoutAnimation';
import { useReducedMotion } from '../lib/useReducedMotion';
import { useTheme } from '../theme/ThemeContext';

type TargetConfig = Record<string, unknown>;

interface BanksTargetsEditorProps {
  fields: FieldDef[];
  targets: TargetConfig[];
  onChange: (targets: TargetConfig[]) => void;
  /** Reports a target field's numeric validity to the editor. */
  onValidityChange?: (key: string, valid: boolean) => void;
}

/**
 * Renders target field editors with add and remove controls.
 * @param props - Target field definitions, target values, and a change handler.
 * @returns The target editor element.
 */
export function BanksTargetsEditor({
  fields,
  targets,
  onChange,
  onValidityChange,
}: Readonly<BanksTargetsEditorProps>): ReactElement {
  const theme = useTheme();
  const reduced = useReducedMotion();

  const setField = (index: number, key: string, value: unknown): void => {
    onChange(targets.map((target, i) => (i === index ? { ...target, [key]: value } : target)));
  };

  const removeTarget = (index: number): void => {
    // Cards are keyed by index, so reindexing while a field is focused could
    // carry its draft into the next target. Blur and let the revert land first.
    Keyboard.dismiss();
    animateNextLayout(reduced);
    setTimeout(() => {
      onChange(targets.filter((_, i) => i !== index));
    }, 0);
  };

  const addTarget = (): void => {
    animateNextLayout(reduced);
    onChange([...targets, {}]);
  };

  return (
    <View style={styles.targets}>
      <SectionLabel style={styles.sectionLabel}>TARGETS</SectionLabel>
      {targets.map((target, index) => (
        <Card key={`target-${String(index)}`} elevation={0} style={styles.targetCard}>
          <View style={styles.targetHeader}>
            <Text style={[theme.typography.h3, { color: theme.colors.text }]}>
              Target {String(index + 1)}
            </Text>
            <Button
              title="Remove"
              variant="ghost"
              size="sm"
              icon="trash-outline"
              fullWidth={false}
              onPress={() => {
                removeTarget(index);
              }}
            />
          </View>
          {fields.map((field) => (
            <FieldInput
              key={field.key}
              field={field}
              value={target[field.key]}
              onChange={(value) => {
                setField(index, field.key, value);
              }}
              onValidityChange={onValidityChange}
              validityKey={`targets.${String(index)}.${field.key}`}
            />
          ))}
        </Card>
      ))}
      <Button
        title="Add target"
        variant="secondary"
        size="sm"
        icon="add"
        fullWidth={false}
        onPress={addTarget}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  targets: { marginTop: 20, gap: 12 },
  sectionLabel: { marginBottom: 8, marginLeft: 4 },
  targetCard: { gap: 4, backgroundColor: 'transparent' },
  targetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
});
