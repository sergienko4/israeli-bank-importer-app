/**
 * Banks editor: lists configured banks, lets the user add one from the catalog,
 * edit its credential fields and targets, save (via the config PUT), or remove it
 * (via the bank DELETE endpoint). Bank/target fields come from the manifest's
 * `bankMap` section, so they stay in sync with the importer.
 */
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Button, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';

import { getConfig, getManifest, removeBank, saveConfig } from '../api/importerClient';
import type { ConfigObject, FieldDef, Manifest, SectionDef } from '../api/manifest';
import { useAuth } from '../auth/AuthContext';
import { FieldInput } from '../components/FieldInput';

type BankConfig = Record<string, unknown>;
type TargetConfig = Record<string, unknown>;

interface Props {
  onBack: () => void;
}

/**
 * Reads the banks map from a config object.
 * @param config - The full config.
 * @returns The banks keyed by id.
 */
function banksOf(config: ConfigObject): Record<string, BankConfig> {
  const banks = config.banks;
  return typeof banks === 'object' && banks !== null ? (banks as Record<string, BankConfig>) : {};
}

/**
 * Reads a bank's targets array.
 * @param bank - A bank config.
 * @returns The targets, or an empty array.
 */
function targetsOf(bank: BankConfig): TargetConfig[] {
  return Array.isArray(bank.targets) ? (bank.targets as TargetConfig[]) : [];
}

/**
 * Templates a new bank with empty required fields and one empty target.
 * @param required - The bank's required field keys.
 * @returns A new bank config.
 */
function templateBank(required: string[]): BankConfig {
  const fields = Object.fromEntries(required.map((key) => [key, '']));
  return { ...fields, targets: [{}] };
}

/**
 * Finds the manifest's bankMap section (bank + target field definitions).
 * @param manifest - The manifest.
 * @returns The bankMap section, or undefined.
 */
function bankSection(manifest: Manifest): SectionDef | undefined {
  return manifest.sections.find((section) => section.kind === 'bankMap');
}

interface TargetsProps {
  fields: FieldDef[];
  targets: TargetConfig[];
  onChange: (targets: TargetConfig[]) => void;
}

/**
 * Renders the per-target field editors with add/remove controls.
 * @param props - Target field defs, the targets, and a change handler.
 * @returns The targets editor.
 */
function TargetsEditor({ fields, targets, onChange }: TargetsProps) {
  const setField = (index: number, key: string, value: unknown) => {
    onChange(targets.map((target, i) => (i === index ? { ...target, [key]: value } : target)));
  };
  return (
    <View style={styles.targets}>
      <Text style={styles.subTitle}>Targets</Text>
      {targets.map((target, index) => (
        <View key={`target-${String(index)}`} style={styles.target}>
          <Text style={styles.targetLabel}>Target {String(index + 1)}</Text>
          {fields.map((field) => (
            <FieldInput
              key={field.key}
              field={field}
              value={target[field.key]}
              onChange={(value) => { setField(index, field.key, value); }}
            />
          ))}
          <Button
            title="Remove target"
            color="#b00020"
            onPress={() => { onChange(targets.filter((_, i) => i !== index)); }}
          />
        </View>
      ))}
      <Button title="Add target" onPress={() => { onChange([...targets, {}]); }} />
    </View>
  );
}

/**
 * Renders the banks editor screen.
 * @param props - Callback to return to the home screen.
 * @returns The banks editor element.
 */
export function BanksScreen({ onBack }: Props) {
  const { connection } = useAuth();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [config, setConfig] = useState<ConfigObject>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
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
          setError(e instanceof Error ? e.message : 'Failed to load banks.');
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
    setSelected(null);
    setReloadKey((key) => key + 1);
  };

  const setBank = (id: string, bank: BankConfig) => {
    setConfig((current) => ({ ...current, banks: { ...banksOf(current), [id]: bank } }));
  };

  const startAdd = (id: string) => {
    const required = manifest?.bankRequirements[id]?.required ?? [];
    setBank(id, templateBank(required));
    setSaveErrors(null);
    setSelected(id);
  };

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

  const doRemove = async (id: string) => {
    if (!connection) {
      return;
    }
    const result = await removeBank(connection, id);
    if (result.ok) {
      reload();
    } else {
      setError(result.error ?? 'Could not remove the bank.');
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

  const section = manifest ? bankSection(manifest) : undefined;
  const banks = banksOf(config);

  if (selected && section) {
    const bank = banks[selected] ?? {};
    return (
      <ScrollView contentContainerStyle={styles.form}>
        <Text style={styles.title}>{manifest?.bankRequirements[selected]?.displayName ?? selected}</Text>
        {(section.bankFields ?? []).map((field) => (
          <FieldInput
            key={field.key}
            field={field}
            value={bank[field.key]}
            onChange={(value) => { setBank(selected, { ...bank, [field.key]: value }); }}
          />
        ))}
        <TargetsEditor
          fields={section.targetFields ?? []}
          targets={targetsOf(bank)}
          onChange={(targets) => { setBank(selected, { ...bank, targets }); }}
        />
        {saveErrors ? saveErrors.map((msg, i) => (
          <Text key={`err-${String(i)}`} style={styles.error}>{msg}</Text>
        )) : null}
        {saving ? <ActivityIndicator /> : (
          <View style={styles.actions}>
            <Button title="Save" onPress={() => { void save(); }} />
            <Button title="Back to banks" color="#666" onPress={() => { setSelected(null); }} />
          </View>
        )}
      </ScrollView>
    );
  }

  const configuredIds = Object.keys(banks);
  const catalog = (manifest?.banks ?? []).filter((id) => !configuredIds.includes(id));

  return (
    <ScrollView contentContainerStyle={styles.list}>
      <Text style={styles.title}>Banks</Text>
      {configuredIds.length === 0 ? <Text style={styles.help}>No banks configured yet.</Text> : null}
      {configuredIds.map((id) => (
        <View key={id} style={styles.bankRow}>
          <TouchableOpacity style={styles.bankName} onPress={() => { setSaveErrors(null); setSelected(id); }}>
            <Text style={styles.sectionLabel}>{manifest?.bankRequirements[id]?.displayName ?? id}</Text>
          </TouchableOpacity>
          <Button title="Remove" color="#b00020" onPress={() => { void doRemove(id); }} />
        </View>
      ))}

      <Text style={styles.subTitle}>Add a bank</Text>
      {catalog.map((id) => (
        <TouchableOpacity key={id} style={styles.catalogRow} onPress={() => { startAdd(id); }}>
          <Text style={styles.sectionLabel}>+ {manifest?.bankRequirements[id]?.displayName ?? id}</Text>
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
  subTitle: { fontSize: 16, fontWeight: '600', marginTop: 20, marginBottom: 8 },
  sectionLabel: { fontSize: 16, color: '#222' },
  help: { fontSize: 13, color: '#888', marginVertical: 8 },
  bankRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  bankName: { flex: 1 },
  catalogRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  targets: { marginTop: 12 },
  target: { borderWidth: 1, borderColor: '#eee', borderRadius: 8, padding: 12, marginBottom: 12 },
  targetLabel: { fontSize: 14, fontWeight: '600', color: '#444', marginBottom: 8 },
  actions: { marginTop: 20, gap: 8 },
  error: { color: '#b00020', marginTop: 8 },
});
