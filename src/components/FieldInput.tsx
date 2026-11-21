/**
 * Renders a single primitive config field (string, secret, number, boolean,
 * select, date) as a themed native control. Group and list kinds are handled by
 * {@link SectionForm}.
 */
import { Ionicons } from '@expo/vector-icons';
import type { ReactElement } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import type { FieldDef } from '../api/manifest';
import type { Theme } from '../theme/ThemeContext';
import { useTheme } from '../theme/ThemeContext';
import { TextControl } from './FieldTextControl';

export { parseNumberFieldText } from './FieldTextControl';

interface Props {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  /** When set, renders a remove control for this field (optional fields). */
  onRemove?: () => void;
  /** Reports numeric validity to the editor that owns Save and Back. */
  onValidityChange?: (key: string, valid: boolean) => void;
  /** Stable key this field reports its validity under. */
  validityKey?: string;
  /** Whether a save owns the screen and the field must not change. */
  disabled?: boolean;
}

/**
 * Picks a chip background that keeps the label legible while pressed.
 * @param theme - The active theme.
 * @param selected - Whether the chip is selected.
 * @param pressed - Whether it is pressed.
 * @returns The chip fill.
 */
function chipBackground(theme: Theme, selected: boolean, pressed: boolean): string {
  if (!pressed) {
    return selected ? theme.colors.primary : theme.colors.surface;
  }
  return selected ? theme.colors.primaryPressed : theme.colors.primarySoft;
}

/**
 * Renders the option chips for a `select` field.
 * @param props - The field, current value, and change handler.
 * @returns The select control.
 */
function SelectControl({ field, value, onChange, disabled }: Readonly<Props>): ReactElement {
  const theme = useTheme();
  const label = field.required ? `${field.label}, required` : field.label;
  return (
    <View style={styles.chips}>
      {(field.options ?? []).map((option) => {
        const selected = value === option;
        return (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${option}`}
            accessibilityHint={field.help}
            accessibilityState={{ selected, disabled }}
            style={({ pressed }) => [
              styles.chip,
              {
                borderRadius: theme.radius.pill,
                borderColor: selected || pressed ? theme.colors.primary : theme.colors.borderStrong,
                backgroundColor: chipBackground(theme, selected, pressed),
              },
            ]}
            disabled={disabled}
            onPress={() => {
              onChange(option);
            }}
          >
            <Text
              style={{
                color: selected ? theme.colors.onPrimary : theme.colors.text,
                fontWeight: '500',
                fontSize: 14,
              }}
            >
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Renders a labelled config field with optional help text. Boolean fields
 * render as an inline label + switch row; everything else stacks label + input.
 * An optional remove control appears for user-added (optional) fields.
 * @param props - The field, current value, change handler, and optional remove.
 * @returns The field row.
 */
export function FieldInput({
  field,
  value,
  onChange,
  onRemove,
  onValidityChange,
  validityKey,
  disabled = false,
}: Readonly<Props>): ReactElement {
  const theme = useTheme();
  const accessibleLabel = field.required ? `${field.label}, required` : field.label;
  const labelText = (
    <Text style={[styles.label, { color: theme.colors.text }]}>
      {field.label}
      {field.required ? <Text style={{ color: theme.colors.danger }}> *</Text> : null}
    </Text>
  );
  const removeBtn = onRemove ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Remove ${field.label}`}
      hitSlop={8}
      onPress={onRemove}
      style={styles.remove}
    >
      <Ionicons name="close-circle" size={18} color={theme.colors.textSubtle} accessible={false} />
    </Pressable>
  ) : null;

  if (field.kind === 'boolean') {
    const checked = value === true;
    return (
      <View style={styles.boolRow}>
        <View style={styles.boolText}>
          {labelText}
          {field.help ? (
            <Text style={[styles.help, { color: theme.colors.textSubtle }]}>{field.help}</Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel={accessibleLabel}
          accessibilityHint={field.help}
          accessibilityState={{ checked, disabled }}
          disabled={disabled}
          onPress={() => {
            onChange(!checked);
          }}
          style={({ pressed }) => [
            styles.switchTarget,
            pressed
              ? { backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.sm }
              : null,
          ]}
        >
          <View pointerEvents="none">
            <Switch
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              disabled={disabled}
              value={checked}
              trackColor={{ true: theme.colors.primary, false: theme.colors.borderStrong }}
              thumbColor={theme.colors.surface}
            />
          </View>
        </Pressable>
        {removeBtn}
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <View style={styles.labelRow}>
        {labelText}
        {removeBtn}
      </View>
      {field.kind === 'select' ? (
        <SelectControl field={field} value={value} onChange={onChange} disabled={disabled} />
      ) : (
        <TextControl
          field={field}
          value={value}
          onChange={onChange}
          onValidityChange={onValidityChange}
          validityKey={validityKey}
          disabled={disabled}
        />
      )}
      {field.help ? (
        <Text style={[styles.help, { color: theme.colors.textSubtle }]}>{field.help}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginBottom: 16 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 14, marginBottom: 6, fontWeight: '600' },
  remove: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  help: { fontSize: 12, marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    minHeight: 44,
    minWidth: 44,
    paddingVertical: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  boolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 12,
    minHeight: 44,
  },
  boolText: { flex: 1 },
  switchTarget: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
});
