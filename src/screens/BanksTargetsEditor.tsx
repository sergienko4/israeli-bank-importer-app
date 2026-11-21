/**
 * Per-target bank editor rows for the bank configuration screen.
 */
import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { FieldDef } from '../api/manifest';
import { FieldInput } from '../components/FieldInput';
import { Button, Card, SectionLabel } from '../components/ui';
import { animateNextLayout } from '../lib/layoutAnimation';
import { useReducedMotion } from '../lib/useReducedMotion';
import { useTheme } from '../theme/ThemeContext';

type TargetConfig = Record<string, unknown>;

/**
 * Stable editor identities for target objects.
 *
 * The config array only holds plain values, so an index cannot identify a card:
 * removing one would shift every later card and carry its draft along. The
 * WeakMap gives each object an id that survives edits (which copy the id to the
 * replacement object) and disappears with the object.
 */
const targetIds = new WeakMap<TargetConfig, string>();
let nextTargetId = 0;

/**
 * Reads or assigns the stable id of one target object.
 * @param target - The target being rendered.
 * @returns Its editor identity.
 */
function targetId(target: TargetConfig): string {
  const existing = targetIds.get(target);
  if (existing !== undefined) {
    return existing;
  }
  nextTargetId += 1;
  const id = `target-${String(nextTargetId)}`;
  targetIds.set(target, id);
  return id;
}

/**
 * Carries a target's identity across the copy made by an edit.
 * @param from - The object being replaced.
 * @param to - The replacement object.
 */
function inheritTargetId(from: TargetConfig, to: TargetConfig): void {
  targetIds.set(to, targetId(from));
}

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
    const current = targets[index];
    const next = { ...current, [key]: value };
    inheritTargetId(current, next);
    onChange(targets.map((target, i) => (i === index ? next : target)));
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
      <SectionLabel style={styles.sectionLabel}>TARGETS</SectionLabel>
      {targets.map((target, index) => (
        <Card key={targetId(target)} elevation={0} style={styles.targetCard}>
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
              validityKey={`targets.${targetId(target)}.${field.key}`}
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
