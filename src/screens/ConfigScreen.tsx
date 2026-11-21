/**
 * Config editor: loads the manifest + current config, lets the user pick a
 * section, edit its fields, and save. Validation errors from the importer are
 * shown inline. Structured sections (banks, lists) are handled elsewhere.
 */
import { type ReactElement, useEffect, useRef, useState } from 'react';
import { Alert, BackHandler } from 'react-native';

import { getConfig, getManifest, type Session } from '../api/importerClient';
import type { ConfigObject, Manifest, SectionDef } from '../api/manifest';
import { useAuth } from '../auth/AuthContext';
import { SectionForm } from '../components/SectionForm';
import { AppHeader, Banner, Button, Card, ErrorView, Loader, Screen } from '../components/ui';
import { setAtPath } from '../config/formState';
import { editableSections } from '../config/sections';
import { hasUnsavedChanges } from '../lib/unsavedChanges';
import { useInvalidFields } from '../lib/useInvalidFields';
import { saveConfigSection } from './configSave';
import { ConfigSectionList } from './ConfigSectionList';
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

interface ConfigErrorProps {
  error: string;
  onRetry: () => void;
}

function ConfigError({ error, onRetry }: Readonly<ConfigErrorProps>): ReactElement {
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
}: Readonly<ConfigSectionEditorProps>): ReactElement {
  const { report, guard } = useInvalidFields();

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      guard(onBack);
      return true;
    });
    return () => {
      sub.remove();
    };
  }, [guard, onBack]);

  return (
    <Screen
      header={
        <AppHeader
          title={selected.label}
          subtitle="Edit fields and save"
          onBack={() => {
            guard(onBack);
          }}
          backDisabled={saving}
        />
      }
      notice={saveErrors?.length ? <Banner messages={saveErrors} /> : undefined}
      footer={
        <Button
          title="Save changes"
          icon="checkmark"
          loading={saving}
          onPress={() => {
            guard(onSave);
          }}
        />
      }
    >
      <Card>
        <SectionForm
          section={selected}
          config={config}
          onChange={onChange}
          onValidityChange={report}
        />
      </Card>
    </Screen>
  );
}

/**
 * Loads the manifest and config, keeping the loaded copy as the draft baseline.
 * @param connection - The active importer session.
 * @returns The loaded data, the draft setters, and a retry.
 */
function useConfigData(connection: Session | null): {
  manifest: Manifest | null;
  config: ConfigObject;
  baseline: ConfigObject | null;
  loading: boolean;
  error: string | null;
  setConfig: (config: ConfigObject | ((current: ConfigObject) => ConfigObject)) => void;
  setBaseline: (config: ConfigObject) => void;
  reload: () => void;
} {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [config, setConfig] = useState<ConfigObject>({});
  const [baseline, setBaseline] = useState<ConfigObject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const connectionRef = useRef(connection);

  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);

  useEffect(() => {
    const activeConnection = connectionRef.current;
    if (!activeConnection) {
      return undefined;
    }
    let active = true;
    const run = async (): Promise<void> => {
      try {
        const [loadedManifest, loadedConfig] = await Promise.all([
          getManifest(activeConnection),
          getConfig(activeConnection),
        ]);
        if (active) {
          setManifest(loadedManifest);
          setConfig(loadedConfig);
          setBaseline(loadedConfig);
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
  }, [connection?.baseUrl, reloadKey]);

  const reload = (): void => {
    setError(null);
    setLoading(true);
    setReloadKey((key) => key + 1);
  };

  return { manifest, config, baseline, loading, error, setConfig, setBaseline, reload };
}

/**
 * Renders the config editor screen.
 * @param props - Optional drill-down depth reporter for the tab shell.
 * @returns The config editor element.
 */
export function ConfigScreen({ onDepthChange }: Readonly<Props>): ReactElement {
  const { connection } = useAuth();
  const { manifest, config, baseline, loading, error, setConfig, setBaseline, reload } =
    useConfigData(connection);
  const [selected, setSelected] = useState<SectionDef | null>(null);
  const [showOtp, setShowOtp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErrors, setSaveErrors] = useState<string[] | null>(null);
  const saveInFlight = useRef(false);
  const configRef = useRef(config);

  useEffect(() => {
    configRef.current = config;
  }, [config]);
  useEffect(() => {
    onDepthChange?.(selected || showOtp ? 1 : 0);
  }, [selected, showOtp, onDepthChange]);

  const update = (path: string[], value: unknown): void => {
    setConfig((current) => setAtPath(current, path, value));
  };
  const save = (): Promise<void> =>
    saveConfigSection({
      connection,
      config,
      currentConfig: () => configRef.current,
      saveInFlight,
      setSaving,
      setSaveErrors,
      setBaseline,
      setSelected,
    });

  const closeOtp = (): void => {
    setShowOtp(false);
  };
  const discardSelected = (): void => {
    if (saveInFlight.current) {
      return;
    }
    if (baseline !== null) {
      setConfig(baseline);
    }
    setSaveErrors(null);
    setSelected(null);
  };
  const closeSelected = (): void => {
    if (saveInFlight.current) {
      return;
    }
    if (baseline !== null && hasUnsavedChanges(baseline, config)) {
      Alert.alert('Discard changes?', 'Your edits to this section have not been saved.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: discardSelected },
      ]);
      return;
    }
    discardSelected();
  };
  const submitSave = (): void => {
    void save();
  };

  if (loading) {
    return (
      <Screen scroll={false} header={<AppHeader title="Configuration" />}>
        <Loader label="Loading configuration" />
      </Screen>
    );
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
