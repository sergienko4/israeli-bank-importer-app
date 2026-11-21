/**
 * State model and pure helpers for the banks screen.
 */
import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { getConfig, getManifest, type Session } from '../api/importerClient';
import type { ConfigObject, FieldDef, Manifest, SectionDef } from '../api/manifest';
import { useAuth } from '../auth/AuthContext';
import { type BankConfig, banksOf } from '../lib/bankDrafts';
import { animateNextLayout } from '../lib/layoutAnimation';
import { useReducedMotion } from '../lib/useReducedMotion';
import { closeBanksEditor, removeBankFromImporter, saveBanksConfig } from './bankEditorActions';

/** Editable bank configuration values keyed by manifest field id. */
export type { BankConfig };
/** Reads the banks map from a config object (re-exported for screen callers). */
export { banksOf };

/** Editable target configuration values keyed by manifest field id. */
export type TargetConfig = Record<string, unknown>;

/** State and actions consumed by the banks screen routes. */
export interface BanksScreenModel {
  manifest: Manifest | null;
  config: ConfigObject;
  loading: boolean;
  error: string | null;
  selected: string | null;
  saving: boolean;
  saveErrors: string[] | null;
  sheetOpen: boolean;
  reload: () => void;
  closeSelected: () => void;
  selectBank: (id: string) => void;
  setBank: (id: string, bank: BankConfig) => void;
  addField: (id: string, bank: BankConfig, field: FieldDef) => void;
  removeField: (id: string, bank: BankConfig, key: string) => void;
  startAdd: (id: string) => void;
  save: () => Promise<void>;
  confirmRemove: (id: string) => void;
  nameOf: (id: string) => string;
  openSheet: () => void;
  closeSheet: () => void;
}

interface BanksDataState {
  manifest: Manifest | null;
  config: ConfigObject;
  baseline: ConfigObject | null;
  loading: boolean;
  error: string | null;
  setConfig: (config: ConfigObject | ((current: ConfigObject) => ConfigObject)) => void;
  setBaseline: (config: ConfigObject) => void;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
}

/**
 * Reads a bank's targets array.
 * @param bank - A bank config.
 * @returns The targets, or an empty array.
 */
export function targetsOf(bank: BankConfig): TargetConfig[] {
  return Array.isArray(bank.targets) ? (bank.targets as TargetConfig[]) : [];
}

/**
 * Finds the manifest's bankMap section.
 * @param manifest - The manifest.
 * @returns The bankMap section, or undefined.
 */
export function bankSection(manifest: Manifest): SectionDef | undefined {
  return manifest.sections.find((section) => section.kind === 'bankMap');
}

/**
 * Returns bank fields that currently exist on a bank config.
 * @param fields - The full bank field catalog.
 * @param bank - The bank config.
 * @returns The subset of fields present on the bank.
 */
export function presentFields(fields: FieldDef[], bank: BankConfig): FieldDef[] {
  return fields.filter((field) => Object.hasOwn(bank, field.key));
}

function templateBank(required: string[]): BankConfig {
  const fields = Object.fromEntries(required.map((key) => [key, '']));
  return { ...fields, targets: [{}] };
}

function defaultForField(field: FieldDef): unknown {
  return field.kind === 'boolean' ? false : '';
}

function withoutField(bank: BankConfig, key: string): BankConfig {
  return Object.fromEntries(Object.entries(bank).filter(([fieldKey]) => fieldKey !== key));
}

function confirmBankRemoval(
  id: string,
  nameOf: (id: string) => string,
  doRemove: (id: string) => Promise<void>,
): void {
  Alert.alert(
    'Delete bank?',
    `Remove ${nameOf(id)} from this importer configuration?`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void doRemove(id);
        },
      },
    ],
    { cancelable: true },
  );
}

function useBanksData(connection: Session | null, reloadKey: number): BanksDataState {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [config, setConfig] = useState<ConfigObject>({});
  const [baseline, setBaseline] = useState<ConfigObject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
          setError(e instanceof Error ? e.message : 'Failed to load banks.');
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

  return {
    manifest,
    config,
    baseline,
    loading,
    error,
    setConfig,
    setBaseline,
    setError,
    setLoading,
  };
}

/**
 * Builds the state model used by the banks screen.
 * @param onDepthChange - Optional drill-down depth reporter.
 * @returns Banks screen state and actions.
 */
export function useBanksScreenModel(
  onDepthChange: ((depth: number) => void) | undefined,
): BanksScreenModel {
  const reduced = useReducedMotion();
  const { connection } = useAuth();
  const [reloadKey, setReloadKey] = useState(0);
  const data = useBanksData(connection, reloadKey);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErrors, setSaveErrors] = useState<string[] | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const saveInFlight = useRef(false);
  const removingRef = useRef(false);
  const configRef = useRef(data.config);

  useEffect(() => {
    configRef.current = data.config;
  }, [data.config]);

  useEffect(() => {
    onDepthChange?.(selected ? 1 : 0);
  }, [selected, onDepthChange]);

  const reload = (): void => {
    data.setError(null);
    data.setLoading(true);
    setSelected(null);
    setReloadKey((key) => key + 1);
  };

  const setBank = (id: string, bank: BankConfig): void => {
    data.setConfig((current) => ({ ...current, banks: { ...banksOf(current), [id]: bank } }));
  };

  const addField = (id: string, bank: BankConfig, field: FieldDef): void => {
    animateNextLayout(reduced);
    setBank(id, { ...bank, [field.key]: defaultForField(field) });
    setSheetOpen(false);
  };

  const removeField = (id: string, bank: BankConfig, key: string): void => {
    animateNextLayout(reduced);
    setBank(id, withoutField(bank, key));
  };

  const startAdd = (id: string): void => {
    if (removingRef.current) {
      return;
    }
    const required = data.manifest?.bankRequirements[id]?.required ?? [];
    setBank(id, templateBank(required));
    setSaveErrors(null);
    setSelected(id);
  };

  const save = (): Promise<void> =>
    saveBanksConfig({
      connection,
      config: data.config,
      currentConfig: () => configRef.current,
      saveInFlight,
      removing: removingRef,
      setSaving,
      setSaveErrors,
      setBaseline: data.setBaseline,
      setSelected,
    });

  const doRemove = async (id: string): Promise<void> => {
    if (saveInFlight.current || removingRef.current) {
      return;
    }
    removingRef.current = true;
    try {
      await removeBankFromImporter({
        connection,
        id,
        onRemoved: reload,
        onError: data.setError,
      });
    } finally {
      removingRef.current = false;
    }
  };

  const nameOf = (id: string): string => data.manifest?.bankRequirements[id]?.displayName ?? id;

  const closeSelected = (): void => {
    closeBanksEditor({
      selected,
      baseline: data.baseline,
      config: data.config,
      saving: saveInFlight.current,
      setConfig: data.setConfig,
      setSaveErrors,
      setSelected,
    });
  };

  return {
    ...data,
    selected,
    saving,
    saveErrors,
    sheetOpen,
    reload,
    closeSelected,
    selectBank: (id) => {
      if (removingRef.current) {
        return;
      }
      setSaveErrors(null);
      setSelected(id);
    },
    setBank,
    addField,
    removeField,
    startAdd,
    save,
    confirmRemove: (id) => {
      confirmBankRemoval(id, nameOf, doRemove);
    },
    nameOf,
    openSheet: () => {
      setSheetOpen(true);
    },
    closeSheet: () => {
      setSheetOpen(false);
    },
  };
}
