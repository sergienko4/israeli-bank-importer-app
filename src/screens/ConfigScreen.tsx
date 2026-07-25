/**
 * Config editor: loads the manifest + current config, lets the user pick a
 * section, edit its fields, and save. Validation errors from the importer are
 * shown inline. Structured sections (banks, lists) are handled elsewhere.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Button, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';

import { getConfig, getManifest, saveConfig } from '../api/importerClient';
import type { ConfigObject, Manifest, SectionDef } from '../api/manifest';
import { useAuth } from '../auth/AuthContext';
import { SectionForm } from '../components/SectionForm';
import { setAtPath } from '../config/formState';

interface Props {
  onBack: () => void;
}

/**
 * Renders the config editor screen.
 * @param props - Callback to return to the home screen.
 * @returns The config editor element.
 */
export function ConfigScreen({ onBack }: Props) {
  const { connection } = useAuth();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [config, setConfig] = useState<ConfigObject>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SectionDef | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErrors, setSaveErrors] = useState<string[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!connection) {
      return undefined;
    }
    let active = true;
    const run = async () => {
      try {
        const [loadedManifest, loadedConfig] = await Promise.all([
          getManifest(connection),
          getConfig(connection),
        ]);
        if (active) {
          setManifest(loadedManifest);
          setConfig(loadedConfig);
        }
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : 'Failed to load the config.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    void run();
    return () => { active = false; };
  }, [connection, reloadKey]);

  const reload = () => {
    setError(null);
    setLoading(true);
    setReloadKey((key) => key + 1);
  };

  const update = useCallback((path: string[], value: unknown) => {
    setConfig((current) => setAtPath(current, path, value));
  }, []);

  const save = async () => {
    if (!connection) {
      return;
    }
    setSaving(true);
    setSaveErrors(null);
    const result = await saveConfig(connection, config);
    setSaving(false);
    if (result.ok) {
      setSelected(null);
    } else {
      setSaveErrors(result.errors ?? [result.error ?? 'Save failed.']);
    }
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator /></View>;
  }
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
        <Button title="Retry" onPress={reload} />
        <Button title="Back" onPress={onBack} />
      </View>
    );
  }

  if (selected) {
    return (
      <ScrollView contentContainerStyle={styles.form}>
        <Text style={styles.title}>{selected.label}</Text>
        <SectionForm section={selected} config={config} onChange={update} />
        {saveErrors ? saveErrors.map((msg, i) => (
          <Text key={`err-${String(i)}`} style={styles.error}>{msg}</Text>
        )) : null}
        {saving ? <ActivityIndicator /> : (
          <View style={styles.actions}>
            <Button title="Save" onPress={() => { void save(); }} />
            <Button title="Back to sections" color="#666" onPress={() => { setSelected(null); }} />
          </View>
        )}
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.list}>
      <Text style={styles.title}>Configuration</Text>
      {(manifest?.sections ?? []).map((section) => (
        <TouchableOpacity
          key={section.key}
          style={styles.sectionRow}
          onPress={() => { setSaveErrors(null); setSelected(section); }}
        >
          <Text style={styles.sectionLabel}>
            {section.icon ? `${section.icon}  ` : ''}
            {section.label}
          </Text>
        </TouchableOpacity>
      ))}
      <View style={styles.actions}>
        <Button title="Back" color="#666" onPress={onBack} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, padding: 24 },
  list: { padding: 20, gap: 4 },
  form: { padding: 20 },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 16 },
  sectionRow: { paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  sectionLabel: { fontSize: 16, color: '#222' },
  actions: { marginTop: 20, gap: 8 },
  error: { color: '#b00020', marginTop: 8 },
});
