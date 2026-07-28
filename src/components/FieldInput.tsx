/**
 * Renders a single primitive config field (string, secret, number, boolean,
 * select, date) as a themed native control. Group and list kinds are handled by
 * {@link SectionForm}.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  Pressable, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';

import type { FieldDef } from '../api/manifest';
import { useTheme } from '../theme/ThemeContext';

type ParsedNumberFieldText = { kind: 'valid'; value: number | undefined } | { kind: 'invalid' };

/**
 * Parses numeric config input without allowing NaN or infinite values.
 * @param text - Raw text from the numeric input.
 * @returns A valid parsed value, undefined for empty input, or invalid.
 */
export function parseNumberFieldText(text: string): ParsedNumberFieldText {
  if (text.trim() === '') {
    return { kind: 'valid', value: undefined };
  }
  const value = Number(text);
  return Number.isFinite(value) ? { kind: 'valid', value } : { kind: 'invalid' };
}

interface Props {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  /** When set, renders a remove control for this field (optional fields). */
  onRemove?: () => void;
}

/**
 * Renders the option chips for a `select` field.
 * @param props - The field, current value, and change handler.
 * @returns The select control.
 */
function SelectControl({ field, value, onChange }: Props) {
  const theme = useTheme();
  return (
    <View style={styles.chips}>
      {(field.options ?? []).map((option) => {
        const selected = value === option;
        return (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityLabel={`${field.label}: ${option}`}
            accessibilityState={{ selected }}
            style={({ pressed }) => [
              styles.chip,
              {
                borderRadius: theme.radius.pill,
                borderColor: selected ? theme.colors.primary : theme.colors.border,
                backgroundColor: selected ? theme.colors.primary : theme.colors.surface,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
            onPress={() => { onChange(option); }}
          >
            <Text style={{ color: selected ? theme.colors.onPrimary : theme.colors.text, fontWeight: '500', fontSize: 14 }}>
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Renders a themed text/number/secret input with a focus ring.
 * @param props - The field, current value, and change handler.
 * @returns The input element.
 */
function TextControl({ field, value, onChange }: Props) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const isNumber = field.kind === 'number';
  return (
    <TextInput
      style={[
        styles.input,
        {
          borderColor: focused ? theme.colors.primary : theme.colors.border,
          borderWidth: focused ? 2 : 1,
          backgroundColor: theme.colors.surface,
          color: theme.colors.text,
          borderRadius: theme.radius.md,
        },
      ]}
      keyboardType={isNumber ? 'numeric' : 'default'}
      secureTextEntry={field.kind === 'secret'}
      accessibilityLabel={field.label}
      autoCapitalize="none"
      autoCorrect={false}
      placeholderTextColor={theme.colors.textSubtle}
      value={value === undefined || value === null ? '' : String(value)}
      onChangeText={(text) => {
        if (!isNumber) {
          onChange(text);
          return;
        }
        const parsed = parseNumberFieldText(text);
        if (parsed.kind === 'valid') {
          onChange(parsed.value);
        }
      }}
      onFocus={() => { setFocused(true); }}
      onBlur={() => { setFocused(false); }}
    />
  );
}

/**
 * Renders a labelled config field with optional help text. Boolean fields
 * render as an inline label + switch row; everything else stacks label + input.
 * An optional remove control appears for user-added (optional) fields.
 * @param props - The field, current value, change handler, and optional remove.
 * @returns The field row.
 */
export function FieldInput({ field, value, onChange, onRemove }: Props) {
  const theme = useTheme();
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
      <Ionicons name="close-circle" size={18} color={theme.colors.textSubtle} />
    </Pressable>
  ) : null;

  if (field.kind === 'boolean') {
    return (
      <View style={styles.boolRow}>
        <View style={styles.boolText}>
          {labelText}
          {field.help ? <Text style={[styles.help, { color: theme.colors.textSubtle }]}>{field.help}</Text> : null}
        </View>
        <Switch
          accessibilityRole="switch"
          accessibilityLabel={field.label}
          accessibilityState={{ checked: value === true }}
          value={value === true}
          onValueChange={onChange}
          trackColor={{ true: theme.colors.primary, false: theme.colors.borderStrong }}
          thumbColor="#FFFFFF"
        />
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
        <SelectControl field={field} value={value} onChange={onChange} />
      ) : (
        <TextControl field={field} value={value} onChange={onChange} />
      )}
      {field.help ? <Text style={[styles.help, { color: theme.colors.textSubtle }]}>{field.help}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginBottom: 16 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 14, marginBottom: 6, fontWeight: '600' },
  remove: {
    minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  help: { fontSize: 12, marginTop: 6 },
  input: { minHeight: 44, padding: 12, fontSize: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1, minHeight: 44, minWidth: 44, paddingVertical: 8, paddingHorizontal: 16, justifyContent: 'center',
  },
  boolRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12, minHeight: 44,
  },
  boolText: { flex: 1 },
});
