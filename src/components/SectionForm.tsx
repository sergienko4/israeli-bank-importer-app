/**
 * Renders a manifest section's fields against the current config: primitive
 * fields via {@link FieldInput}, nested `group` fields recursively, and simple
 * string `list` fields inline. Structured object-lists are summarized (edited on
 * the web portal for now).
 */
import { useState } from 'react';
import {
  StyleSheet, Text, TextInput, View,
} from 'react-native';

import type { ConfigObject, FieldDef, SectionDef } from '../api/manifest';
import { getAtPath } from '../config/formState';
import { isFieldVisible } from '../config/visibility';
import { useTheme } from '../theme/ThemeContext';
import { Button } from './ui';
import { FieldInput } from './FieldInput';

/** Change handler: replaces the value at a config key path. */
type ChangeAt = (path: string[], value: unknown) => void;

interface ListFieldProps {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
}

/**
 * Renders a string list (add/edit/remove) or a summary of a structured list.
 * @param props - The list field, its value, and a change handler.
 * @returns The list editor.
 */
function ListField({ field, value, onChange }: ListFieldProps) {
  const theme = useTheme();
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const items = Array.isArray(value) ? (value as unknown[]) : [];
  if ((field.fields?.length ?? 0) > 0) {
    return (
      <View style={[styles.group, { borderLeftColor: theme.colors.border }]}>
        <Text style={[styles.groupLabel, { color: theme.colors.text }]}>{field.label}</Text>
        <Text style={[styles.help, { color: theme.colors.textSubtle }]}>
          {String(items.length)} item(s). Structured lists are edited in the web portal.
        </Text>
      </View>
    );
  }
  const strings = items.map((item) => String(item));
  const setItem = (index: number, text: string) => {
    onChange(strings.map((existing, i) => (i === index ? text : existing)));
  };
  return (
    <View style={[styles.group, { borderLeftColor: theme.colors.primarySoft }]}>
      <Text style={[styles.groupLabel, { color: theme.colors.text }]}>{field.label}</Text>
      {strings.map((entry, index) => (
        <View key={`${field.key}-${String(index)}`} style={styles.listRow}>
          <TextInput
            accessibilityLabel={`${field.label} item ${String(index + 1)}`}
            style={[styles.listInput, {
              borderColor: focusedIndex === index ? theme.colors.primary : theme.colors.border,
              borderWidth: focusedIndex === index ? 2 : 1,
              backgroundColor: theme.colors.surface,
              color: theme.colors.text,
              borderRadius: theme.radius.md,
              padding: focusedIndex === index ? 11 : 12,
            }]}
            autoCapitalize="none"
            placeholderTextColor={theme.colors.textSubtle}
            value={entry}
            onChangeText={(text) => { setItem(index, text); }}
            onFocus={() => { setFocusedIndex(index); }}
            onBlur={() => { setFocusedIndex((current) => (current === index ? null : current)); }}
          />
          <Button
            title="Remove"
            variant="ghost"
            size="sm"
            icon="trash-outline"
            fullWidth={false}
            onPress={() => { onChange(strings.filter((_, i) => i !== index)); }}
          />
        </View>
      ))}
      <Button
        title="Add item"
        variant="secondary"
        size="sm"
        icon="add"
        fullWidth={false}
        onPress={() => { onChange([...strings, '']); }}
        style={styles.addBtn}
      />
    </View>
  );
}

interface FieldsProps {
  fields: FieldDef[];
  basePath: string[];
  config: ConfigObject;
  onChange: ChangeAt;
}

/**
 * Renders a list of fields at a base path, recursing into groups.
 * @param props - The fields, their base path, the config, and a change handler.
 * @returns The rendered fields.
 */
function Fields({
  fields, basePath, config, onChange,
}: FieldsProps) {
  const theme = useTheme();
  const parent = (getAtPath(config, basePath) ?? {}) as Record<string, unknown>;
  return (
    <>
      {fields.map((field) => {
        if (!isFieldVisible(field, parent)) {
          return null;
        }
        const path = [...basePath, field.key];
        if (field.kind === 'group') {
          return (
            <View key={field.key} style={[styles.group, { borderLeftColor: theme.colors.primarySoft }]}>
              <Text style={[styles.groupLabel, { color: theme.colors.text }]}>{field.label}</Text>
              <Fields fields={field.fields ?? []} basePath={path} config={config} onChange={onChange} />
            </View>
          );
        }
        if (field.kind === 'list') {
          return (
            <ListField
              key={field.key}
              field={field}
              value={parent[field.key]}
              onChange={(next) => { onChange(path, next); }}
            />
          );
        }
        return (
          <FieldInput
            key={field.key}
            field={field}
            value={parent[field.key]}
            onChange={(next) => { onChange(path, next); }}
          />
        );
      })}
    </>
  );
}

interface SectionFormProps {
  section: SectionDef;
  config: ConfigObject;
  onChange: ChangeAt;
}

/**
 * Renders an `object` section's fields. Non-object sections show a short note.
 * @param props - The section, the config, and a change handler.
 * @returns The section form.
 */
export function SectionForm({ section, config, onChange }: SectionFormProps) {
  const theme = useTheme();
  if (section.kind !== 'object') {
    return (
      <Text style={[styles.help, { color: theme.colors.textSubtle }]}>
        This section is managed in the web portal.
      </Text>
    );
  }
  return <Fields fields={section.fields ?? []} basePath={[section.key]} config={config} onChange={onChange} />;
}

const styles = StyleSheet.create({
  group: {
    marginBottom: 16, paddingLeft: 12, borderLeftWidth: 3,
  },
  groupLabel: { fontSize: 15, fontWeight: '600', marginBottom: 10 },
  help: { fontSize: 12, marginTop: 4, marginBottom: 8 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  listInput: {
    flex: 1, minHeight: 44, fontSize: 16,
  },
  addBtn: { marginTop: 4 },
});
