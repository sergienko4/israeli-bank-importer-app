/**
 * Per-target bank editor rows for the bank configuration screen.
 */
import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { FieldDef } from '../api/manifest';
import { FieldInput } from '../components/FieldInput';
import { Button, Card } from '../components/ui';
import { animateNextLayout } from '../lib/layoutAnimation';
import { useReducedMotion } from '../lib/useReducedMotion';
import { useTheme } from '../theme/ThemeContext';

type TargetConfig = Record<string, unknown>;

interface BanksTargetsEditorProps {
  fields: FieldDef[];
  targets: TargetConfig[];
  onChange: (targets: TargetConfig[]) => void;
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
}: BanksTargetsEditorProps): ReactElement {
  const theme = useTheme();
  const reduced = useReducedMotion();

  const setField = (index: number, key: string, value: unknown): void => {
    onChange(targets.map((target, i) => (i === index ? { ...target, [key]: value } : target)));
  };

  const removeTarget = (index: number): void => {
    animateNextLayout(reduced);
    onChange(targets.filter((_, i) => i !== index));
  };

  const addTarget = (): void => {
    animateNextLayout(reduced);
    onChange([...targets, {}]);
  };

  return (
    <View style={styles.targets}>
      <Text
        style={[theme.typography.caption, styles.sectionLabel, { color: theme.colors.textSubtle }]}
      >
        TARGETS
      </Text>
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
  sectionLabel: { letterSpacing: 0.6, marginBottom: 8, marginLeft: 4 },
  targetCard: { gap: 4, backgroundColor: 'transparent' },
  targetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
});
