/**
 * Banks editor: lists configured banks, lets the user add one from the catalog,
 * edit its credential fields and targets, save (via the config PUT), or remove it
 * (via the bank DELETE endpoint). Bank/target fields come from the manifest's
 * `bankMap` section, so they stay in sync with the importer.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  Alert, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';

import { getConfig, getManifest, removeBank, saveConfig } from '../api/importerClient';
import type { ConfigObject, FieldDef, Manifest, SectionDef } from '../api/manifest';
import { useAuth } from '../auth/AuthContext';
import { FieldInput } from '../components/FieldInput';
import {
  AppHeader, Banner, Button, Card, Divider, EmptyState, Entrance, ErrorView, ListRow, Screen, Sheet, SkeletonList,
} from '../components/ui';
import { addableFields } from '../config/bankSchema';
import { haptics } from '../lib/haptics';
import { animateNextLayout } from '../lib/layoutAnimation';
import { useReducedMotion } from '../lib/useReducedMotion';
import { useTheme } from '../theme/ThemeContext';

type BankConfig = Record<string, unknown>;
type TargetConfig = Record<string, unknown>;

interface Props {
  /** Reports drill-down depth (0 = bank list, 1 = editing a bank). */
  onDepthChange?: (depth: number) => void;
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

/**
 * The catalog fields currently present on a bank (mirrors the importer portal:
 * a bank only shows the fields it actually has, seeded from its requirements).
 * @param fields - The full bank field catalog.
 * @param bank - The bank config.
 * @returns The subset of fields present on the bank.
 */
function presentFields(fields: FieldDef[], bank: BankConfig): FieldDef[] {
  return fields.filter((field) => Object.prototype.hasOwnProperty.call(bank, field.key));
}

/**
 * The default value to seed when a user adds an optional field.
 * @param field - The field being added.
 * @returns A sensible empty default for the field kind.
 */
function defaultForField(field: FieldDef): unknown {
  return field.kind === 'boolean' ? false : '';
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
  const theme = useTheme();
  const reduced = useReducedMotion();
  const setField = (index: number, key: string, value: unknown) => {
    onChange(targets.map((target, i) => (i === index ? { ...target, [key]: value } : target)));
  };
  const removeTarget = (index: number) => {
    animateNextLayout(reduced);
    onChange(targets.filter((_, i) => i !== index));
  };
  const addTarget = () => {
    animateNextLayout(reduced);
    onChange([...targets, {}]);
  };
  return (
    <View style={styles.targets}>
      <Text style={[theme.typography.caption, styles.sectionLabel, { color: theme.colors.textSubtle }]}>TARGETS</Text>
      {targets.map((target, index) => (
        <Card key={`target-${String(index)}`} elevation={0} style={styles.targetCard}>
          <View style={styles.targetHeader}>
            <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Target {String(index + 1)}</Text>
            <Button
              title="Remove"
              variant="ghost"
              size="sm"
              icon="trash-outline"
              fullWidth={false}
              onPress={() => { removeTarget(index); }}
            />
          </View>
          {fields.map((field) => (
            <FieldInput
              key={field.key}
              field={field}
              value={target[field.key]}
              onChange={(value) => { setField(index, field.key, value); }}
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
        onPress={() => { addTarget(); }}
      />
    </View>
  );
}

/**
 * Renders the banks editor screen.
 * @param props - Callback to return to the home screen.
 * @returns The banks editor element.
 */
export function BanksScreen({ onDepthChange }: Props) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const { connection } = useAuth();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [config, setConfig] = useState<ConfigObject>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErrors, setSaveErrors] = useState<string[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);

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

  useEffect(() => {
    onDepthChange?.(selected ? 1 : 0);
  }, [selected, onDepthChange]);

  const reload = () => {
    setError(null);
    setLoading(true);
    setSelected(null);
    setReloadKey((key) => key + 1);
  };

  const setBank = (id: string, bank: BankConfig) => {
    setConfig((current) => ({ ...current, banks: { ...banksOf(current), [id]: bank } }));
  };

  const addField = (id: string, bank: BankConfig, field: FieldDef) => {
    animateNextLayout(reduced);
    setBank(id, { ...bank, [field.key]: defaultForField(field) });
    setSheetOpen(false);
  };

  const removeField = (id: string, bank: BankConfig, key: string) => {
    animateNextLayout(reduced);
    const next = { ...bank };
    delete next[key];
    setBank(id, next);
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
      haptics.success();
      setSelected(null);
    } else {
      haptics.warning();
      setSaveErrors(result.errors ?? [result.error ?? 'Save failed.']);
    }
  };

  const doRemove = async (id: string) => {
    if (!connection) {
      return;
    }
    const result = await removeBank(connection, id);
    if (result.ok) {
      haptics.success();
      reload();
    } else {
      setError(result.error ?? 'Could not remove the bank.');
    }
  };

  const nameOf = (id: string): string => manifest?.bankRequirements[id]?.displayName ?? id;
  const confirmRemove = (id: string): void => {
    const name = nameOf(id);
    Alert.alert(
      'Delete bank?',
      `Remove ${name} from this importer configuration?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { void doRemove(id); } },
      ],
      { cancelable: true },
    );
  };

  if (loading) {
    return (
      <Screen header={<AppHeader title="Banks" />}>
        <SkeletonList count={3} />
      </Screen>
    );
  }
  if (error) {
    return (
      <Screen scroll={false} header={<AppHeader title="Banks" />}>
        <ErrorView message={error} onRetry={reload} />
      </Screen>
    );
  }

  const section = manifest ? bankSection(manifest) : undefined;
  const banks = banksOf(config);

  if (selected && section) {
    const bank = banks[selected] ?? {};
    const catalog = section.bankFields ?? [];
    const requirement = manifest?.bankRequirements[selected];
    const requiredKeys = new Set<string>(requirement?.required ?? []);
    const present = presentFields(catalog, bank);
    const missing = addableFields(section, requirement, bank);
    return (
      <Screen
        header={<AppHeader title={nameOf(selected)} subtitle="Credentials & targets" onBack={() => { setSelected(null); }} />}
        footer={<Button title="Save changes" icon="checkmark" loading={saving} onPress={() => { void save(); }} />}
      >
        <Text style={[theme.typography.caption, styles.sectionLabel, { color: theme.colors.textSubtle }]}>CREDENTIALS</Text>
        <Card>
          {present.map((field) => {
            const isRequired = requiredKeys.has(field.key);
            return (
              <FieldInput
                key={field.key}
                field={{ ...field, required: isRequired }}
                value={bank[field.key]}
                onChange={(value) => { setBank(selected, { ...bank, [field.key]: value }); }}
                onRemove={isRequired ? undefined : () => { removeField(selected, bank, field.key); }}
              />
            );
          })}
          {missing.length > 0 ? (
            <Button
              title="Add field"
              variant="secondary"
              size="sm"
              icon="add"
              fullWidth={false}
              onPress={() => { setSheetOpen(true); }}
              style={styles.addField}
            />
          ) : null}
        </Card>
        <TargetsEditor
          fields={section.targetFields ?? []}
          targets={targetsOf(bank)}
          onChange={(targets) => { setBank(selected, { ...bank, targets }); }}
        />
        {saveErrors ? <View style={styles.errors}><Banner messages={saveErrors} /></View> : null}

        <Sheet visible={sheetOpen} onClose={() => { setSheetOpen(false); }} title="Add a field">
          <ScrollView>
            {missing.map((field) => (
              <ListRow
                key={field.key}
                icon="add-circle-outline"
                title={field.label}
                subtitle={field.help}
                onPress={() => { addField(selected, bank, field); }}
              />
            ))}
          </ScrollView>
        </Sheet>
      </Screen>
    );
  }

  const configuredIds = Object.keys(banks);
  const catalog = (manifest?.banks ?? []).filter((id) => !configuredIds.includes(id));

  return (
    <Screen header={<AppHeader title="Banks" />}>
      {configuredIds.length === 0 ? (
        <Entrance>
          <EmptyState
            icon="business-outline"
            title="No banks yet"
            message="Add your first bank below to start importing transactions."
          />
        </Entrance>
      ) : (
        <>
          <Text style={[theme.typography.caption, styles.sectionLabel, { color: theme.colors.textSubtle }]}>YOUR BANKS</Text>
          <Card padded={false} style={styles.menu}>
            {configuredIds.map((id, index) => (
              <Entrance key={id} index={index}>
                <ListRow
                  icon="business"
                  title={nameOf(id)}
                  subtitle={`${targetsOf(banks[id] ?? {}).length} target(s)`}
                  onPress={() => { setSaveErrors(null); setSelected(id); }}
                  right={(
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${nameOf(id)}`}
                      onPress={() => { confirmRemove(id); }}
                      style={styles.iconBtn}
                    >
                      <Ionicons name="trash-outline" size={20} color={theme.colors.danger} />
                    </Pressable>
                  )}
                />
                {index < configuredIds.length - 1 ? <Divider style={styles.indent} /> : null}
              </Entrance>
            ))}
          </Card>
        </>
      )}

      {catalog.length > 0 ? (
        <>
          <Text style={[theme.typography.caption, styles.sectionLabel, styles.addLabel, { color: theme.colors.textSubtle }]}>
            ADD A BANK
          </Text>
          <Card padded={false} style={styles.menu}>
            {catalog.map((id, index) => (
              <Entrance key={id} index={index}>
                <ListRow icon="add-circle-outline" title={nameOf(id)} onPress={() => { startAdd(id); }} />
                {index < catalog.length - 1 ? <Divider style={styles.indent} /> : null}
              </Entrance>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  menu: { overflow: 'hidden' },
  indent: { marginLeft: 68 },
  sectionLabel: { letterSpacing: 0.6, marginBottom: 8, marginLeft: 4 },
  addLabel: { marginTop: 20 },
  addField: { marginTop: 8 },
  iconBtn: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  targets: { marginTop: 20, gap: 12 },
  targetCard: { gap: 4, backgroundColor: 'transparent' },
  targetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  errors: { marginTop: 16 },
});
