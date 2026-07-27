/**
 * Config editor: loads the manifest + current config, lets the user pick a
 * section, edit its fields, and save. Validation errors from the importer are
 * shown inline. Structured sections (banks, lists) are handled elsewhere.
 */
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { getConfig, getManifest, saveConfig } from '../api/importerClient';
import type { ConfigObject, Manifest, SectionDef } from '../api/manifest';
import { useAuth } from '../auth/AuthContext';
import { SectionForm } from '../components/SectionForm';
import {
  AppHeader, Banner, Button, Card, Divider, Entrance, ErrorView, ListRow, Loader, Screen,
} from '../components/ui';
import { setAtPath } from '../config/formState';
import { editableSections } from '../config/sections';
import { haptics } from '../lib/haptics';
import { useTheme } from '../theme/ThemeContext';

interface Props {
  onBack: () => void;
}

/**
 * Renders the config editor screen.
 * @param props - Callback to return to the home screen.
 * @returns The config editor element.
 */
export function ConfigScreen({ onBack }: Props) {
  const theme = useTheme();
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
      haptics.success();
      setSelected(null);
    } else {
      haptics.warning();
      setSaveErrors(result.errors ?? [result.error ?? 'Save failed.']);
    }
  };

  if (loading) {
    return (
      <Screen scroll={false} header={<AppHeader title="Configuration" onBack={onBack} />}>
        <Loader label="Loading configuration" />
      </Screen>
    );
  }
  if (error) {
    return (
      <Screen scroll={false} header={<AppHeader title="Configuration" onBack={onBack} />}>
        <ErrorView message={error} onRetry={reload} />
      </Screen>
    );
  }

  if (selected) {
    return (
      <Screen
        header={<AppHeader title={selected.label} subtitle="Edit fields and save" onBack={() => { setSelected(null); }} />}
        footer={<Button title="Save changes" icon="checkmark" loading={saving} onPress={() => { void save(); }} />}
      >
        <Card>
          <SectionForm section={selected} config={config} onChange={update} />
        </Card>
        {saveErrors ? <View style={styles.errors}><Banner messages={saveErrors} /></View> : null}
      </Screen>
    );
  }

  const sections = editableSections(manifest);
  return (
    <Screen header={<AppHeader title="Configuration" onBack={onBack} />}>
      <Text style={[theme.typography.small, styles.hint, { color: theme.colors.textMuted }]}>
        Choose a section to edit.
      </Text>
      <Card padded={false} style={styles.menu}>
        {sections.map((section, index) => (
          <Entrance key={section.key} index={index}>
            <ListRow
              title={section.label}
              emoji={section.icon}
              icon={section.icon ? undefined : 'cube-outline'}
              onPress={() => { haptics.selection(); setSaveErrors(null); setSelected(section); }}
            />
            {index < sections.length - 1 ? <Divider style={styles.indent} /> : null}
          </Entrance>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { marginBottom: 12, marginLeft: 4 },
  menu: { overflow: 'hidden' },
  indent: { marginLeft: 68 },
  errors: { marginTop: 16 },
});
