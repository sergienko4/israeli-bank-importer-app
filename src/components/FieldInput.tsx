/**
 * Renders a single primitive config field (string, secret, number, boolean,
 * select, date) as a native control. Group and list kinds are handled by
 * {@link SectionForm}.
 */
import {
  StyleSheet, Switch, Text, TextInput, TouchableOpacity, View,
} from 'react-native';

import type { FieldDef } from '../api/manifest';

interface Props {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
}

/**
 * Renders the option chips for a `select` field.
 * @param props - The field, current value, and change handler.
 * @returns The select control.
 */
function SelectControl({ field, value, onChange }: Props) {
  return (
    <View style={styles.chips}>
      {(field.options ?? []).map((option) => {
        const selected = value === option;
        return (
          <TouchableOpacity
            key={option}
            style={[styles.chip, selected && styles.chipSelected]}
            onPress={() => { onChange(option); }}
          >
            <Text style={selected ? styles.chipTextSelected : styles.chipText}>{option}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/**
 * Renders the control for the field's kind (excluding group/list).
 * @param props - The field, current value, and change handler.
 * @returns The control element.
 */
function Control({ field, value, onChange }: Props) {
  if (field.kind === 'boolean') {
    return <Switch value={value === true} onValueChange={onChange} />;
  }
  if (field.kind === 'select') {
    return <SelectControl field={field} value={value} onChange={onChange} />;
  }
  if (field.kind === 'number') {
    return (
      <TextInput
        style={styles.input}
        keyboardType="numeric"
        value={value === undefined || value === null ? '' : String(value)}
        onChangeText={(text) => { onChange(text.trim() === '' ? undefined : Number(text)); }}
      />
    );
  }
  return (
    <TextInput
      style={styles.input}
      autoCapitalize="none"
      autoCorrect={false}
      secureTextEntry={field.kind === 'secret'}
      value={value === undefined || value === null ? '' : String(value)}
      onChangeText={onChange}
    />
  );
}

/**
 * Renders a labelled config field with optional help text.
 * @param props - The field, current value, and change handler.
 * @returns The field row.
 */
export function FieldInput({ field, value, onChange }: Props) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>
        {field.label}
        {field.required ? ' *' : ''}
      </Text>
      <Control field={field} value={value} onChange={onChange} />
      {field.help ? <Text style={styles.help}>{field.help}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginBottom: 14 },
  label: { fontSize: 14, color: '#333', marginBottom: 4, fontWeight: '500' },
  help: { fontSize: 12, color: '#888', marginTop: 4 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 16, backgroundColor: '#fff' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#ccc', borderRadius: 16, paddingVertical: 6, paddingHorizontal: 14 },
  chipSelected: { backgroundColor: '#1f6feb', borderColor: '#1f6feb' },
  chipText: { color: '#333' },
  chipTextSelected: { color: '#fff' },
});
