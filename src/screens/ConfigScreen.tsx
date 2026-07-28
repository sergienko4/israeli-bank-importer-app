/**
 * Config editor: loads the manifest + current config, lets the user pick a
 * section, edit its fields, and save. Validation errors from the importer are
 * shown inline. Structured sections (banks, lists) are handled elsewhere.
 */
import { type ReactElement, useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { getConfig, getManifest, saveConfig } from '../api/importerClient';
import type { ConfigObject, Manifest, SectionDef } from '../api/manifest';
import { useAuth } from '../auth/AuthContext';
import { SectionForm } from '../components/SectionForm';
import {
  AppHeader,
  Banner,
  Button,
  Card,
  Divider,
  Entrance,
  ErrorView,
  ListRow,
  Loader,
  Screen,
} from '../components/ui';
import { setAtPath } from '../config/formState';
import { editableSections } from '../config/sections';
import { haptics } from '../lib/haptics';
import { useTheme } from '../theme/ThemeContext';
import { OtpSettingsScreen } from './OtpSettingsScreen';

interface Props {
  /** Reports drill-down depth (0 = section list, 1 = editing a section). */
  onDepthChange?: (depth: number) => void;
}

interface ConfigSectionEditorProps {
  selected: SectionDef;
  config: ConfigObject;
  saving: boolean;
  saveErrors: string[] | null;
  onBack: () => void;
  onSave: () => void;
  onChange: (path: string[], value: unknown) => void;
}

interface ConfigSectionListProps {
  sections: SectionDef[];
  onSelect: (section: SectionDef) => void;
  onShowOtp: () => void;
}

interface ConfigErrorProps {
  error: string;
  onRetry: () => void;
}

function ConfigLoading(): ReactElement {
  return (
    <Screen scroll={false} header={<AppHeader title="Configuration" />}>
      <Loader label="Loading configuration" />
    </Screen>
  );
}

function ConfigError({ error, onRetry }: ConfigErrorProps): ReactElement {
  return (
    <Screen scroll={false} header={<AppHeader title="Configuration" />}>
      <ErrorView message={error} onRetry={onRetry} />
    </Screen>
  );
}

function ConfigSectionEditor({
  selected,
  config,
  saving,
  saveErrors,
  onBack,
  onSave,
  onChange,
}: ConfigSectionEditorProps): ReactElement {
  return (
    <Screen
      header={<AppHeader title={selected.label} subtitle="Edit fields and save" onBack={onBack} />}
      footer={<Button title="Save changes" icon="checkmark" loading={saving} onPress={onSave} />}
    >
      <Card>
        <SectionForm section={selected} config={config} onChange={onChange} />
      </Card>
      {saveErrors ? (
        <View style={styles.errors}>
          <Banner messages={saveErrors} />
        </View>
      ) : null}
    </Screen>
  );
}

function ConfigSectionList({
  sections,
  onSelect,
  onShowOtp,
}: ConfigSectionListProps): ReactElement {
  const theme = useTheme();

  return (
    <Screen header={<AppHeader title="Configuration" />}>
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
              onPress={() => {
                haptics.selection();
                onSelect(section);
              }}
            />
            {index < sections.length - 1 ? <Divider style={styles.indent} /> : null}
          </Entrance>
        ))}
      </Card>

      <Text
        style={[theme.typography.caption, styles.sectionLabel, { color: theme.colors.textSubtle }]}
      >
        DEVICE
      </Text>
      <Card padded={false} style={styles.menu}>
        <ListRow
          icon="key-outline"
          title="OTP delivery"
          subtitle="Collect bank codes in this app or via Telegram"
          onPress={() => {
            haptics.selection();
            onShowOtp();
          }}
        />
      </Card>
    </Screen>
  );
}

/**
 * Renders the config editor screen.
 * @param props - Optional drill-down depth reporter for the tab shell.
 * @returns The config editor element.
 */
export function ConfigScreen({ onDepthChange }: Props): ReactElement {
  const { connection } = useAuth();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [config, setConfig] = useState<ConfigObject>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SectionDef | null>(null);
  const [showOtp, setShowOtp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErrors, setSaveErrors] = useState<string[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!connection) {
      return undefined;
    }
    let active = true;
    const run = async (): Promise<void> => {
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
    return () => {
      active = false;
    };
  }, [connection, reloadKey]);

  const reload = (): void => {
    setError(null);
    setLoading(true);
    setReloadKey((key) => key + 1);
  };

  useEffect(() => {
    onDepthChange?.(selected || showOtp ? 1 : 0);
  }, [selected, showOtp, onDepthChange]);

  const update = useCallback((path: string[], value: unknown) => {
    setConfig((current) => setAtPath(current, path, value));
  }, []);

  const save = async (): Promise<void> => {
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
  const closeOtp = (): void => {
    setShowOtp(false);
  };
  const closeSelected = (): void => {
    setSelected(null);
  };
  const submitSave = (): void => {
    void save();
  };

  if (loading) {
    return <ConfigLoading />;
  }
  if (error) {
    return <ConfigError error={error} onRetry={reload} />;
  }

  if (showOtp) {
    return <OtpSettingsScreen onBack={closeOtp} />;
  }

  if (selected) {
    return (
      <ConfigSectionEditor
        selected={selected}
        config={config}
        saving={saving}
        saveErrors={saveErrors}
        onBack={closeSelected}
        onSave={submitSave}
        onChange={update}
      />
    );
  }

  const sections = editableSections(manifest);
  return (
    <ConfigSectionList
      sections={sections}
      onSelect={(section) => {
        setSaveErrors(null);
        setSelected(section);
      }}
      onShowOtp={() => {
        setShowOtp(true);
      }}
    />
  );
}

const styles = StyleSheet.create({
  hint: { marginBottom: 12, marginLeft: 4 },
  sectionLabel: { letterSpacing: 0.6, marginTop: 20, marginBottom: 8, marginLeft: 4 },
  menu: { overflow: 'hidden' },
  indent: { marginLeft: 68 },
  errors: { marginTop: 16 },
});
