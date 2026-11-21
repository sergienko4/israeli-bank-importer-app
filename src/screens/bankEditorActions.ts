/**
 * Actions the banks editor performs when leaving it: discard a draft, or call
 * the delete endpoint. Kept out of the state hook so each has one reason to
 * change and the hook stays within the project's function-size cap.
 */
import type { RefObject } from 'react';
import { Alert } from 'react-native';

import { removeBank, saveConfig, type Session } from '../api/importerClient';
import type { ConfigObject, SaveResult } from '../api/manifest';
import { banksOf, discardBankDraft, isNewBankDraft } from '../lib/bankDrafts';
import { reportedOrFallback } from '../lib/errorMessages';
import { haptics } from '../lib/haptics';
import { hasUnsavedChanges } from '../lib/unsavedChanges';

/** What the bank editor needs in order to close without losing work. */
interface CloseBankEditorOptions {
  /** The bank being edited, or null when the list is showing. */
  readonly selected: string | null;
  /** The config as loaded from the importer. */
  readonly baseline: ConfigObject | null;
  /** The config currently being edited. */
  readonly config: ConfigObject;
  /** Whether a save is still in flight, which must settle before leaving. */
  readonly saving: boolean;
  /** Replaces the draft config. */
  readonly setConfig: (config: ConfigObject) => void;
  /** Clears any validation message from the previous save. */
  readonly clearErrors: () => void;
  /** Returns to the bank list. */
  readonly close: () => void;
}

/**
 * Closes the bank editor, confirming first when the draft differs from the
 * saved config. A bank that exists only in the draft is removed on discard, so
 * cancelling an add cannot leave a phantom row in the list. A pending save owns
 * the screen until it settles, so its result cannot be discarded underneath it.
 * @param options - The selected id, the saved and draft configs, and callbacks.
 */
export function closeBankEditor(options: CloseBankEditorOptions): void {
  const { selected, baseline, config, saving, setConfig, clearErrors, close } = options;
  if (saving || selected === null) {
    return;
  }
  const finish = (nextConfig?: ConfigObject): void => {
    if (nextConfig !== undefined) {
      setConfig(nextConfig);
    }
    clearErrors();
    close();
  };
  const discard = (): void => {
    finish(baseline === null ? undefined : discardBankDraft(baseline, config, selected));
  };
  if (baseline === null) {
    finish();
    return;
  }
  if (isNewBankDraft(baseline, selected)) {
    Alert.alert('Discard this new bank?', 'It has not been saved yet.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: discard },
    ]);
    return;
  }
  const savedBanks = banksOf(baseline);
  const draftBanks = banksOf(config);
  const savedBank = Object.hasOwn(savedBanks, selected) ? savedBanks[selected] : {};
  const draftBank = Object.hasOwn(draftBanks, selected) ? draftBanks[selected] : {};
  if (hasUnsavedChanges(savedBank, draftBank)) {
    Alert.alert('Discard changes?', 'Your edits to this bank have not been saved.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: discard },
    ]);
    return;
  }
  finish();
}

/**
 * Sends the banks config and applies the result.
 * @param options - The session, submitted draft, and hook callbacks.
 */
export async function saveBanksConfig(options: SaveBanksOptions): Promise<void> {
  const { connection, config, currentConfig, saveInFlight, removing } = options;
  if (!canSave(connection, saveInFlight, removing)) {
    return;
  }
  saveInFlight.current = true;
  options.setSaving(true);
  options.setSaveErrors(null);
  try {
    const result = await saveConfig(connection, config);
    if (!result.ok) {
      haptics.warning();
      options.setSaveErrors(errorsFor(result));
      return;
    }
    haptics.success();
    options.setBaseline(config);
    if (hasUnsavedChanges(config, currentConfig())) {
      options.setSaveErrors(['Saved, but newer edits are still here. Save again.']);
      return;
    }
    options.setSelected(null);
  } catch (error: unknown) {
    haptics.warning();
    options.setSaveErrors(saveFailure(error));
  } finally {
    saveInFlight.current = false;
    options.setSaving(false);
  }
}

/** What a banks save needs from the hook. */
export interface SaveBanksOptions {
  /** The active session, or null when signed out. */
  readonly connection: Session | null;
  /** The draft snapshot to send. */
  readonly config: ConfigObject;
  /** Reads the latest draft after the request settles. */
  readonly currentConfig: () => ConfigObject;
  /** Guards against a second save in the same tick. */
  readonly saveInFlight: RefObject<boolean>;
  /** Guards against a delete and a save overlapping. */
  readonly removing: RefObject<boolean>;
  /** Reports the spinner state. */
  readonly setSaving: (saving: boolean) => void;
  /** Reports validation errors. */
  readonly setSaveErrors: (errors: string[] | null) => void;
  /** Replaces the saved baseline after success. */
  readonly setBaseline: (config: ConfigObject) => void;
  /** Closes the editor. */
  readonly setSelected: (id: string | null) => void;
}

/**
 * Reports whether a save may start.
 * @param connection - The active session.
 * @param saveInFlight - The save guard.
 * @param removing - The delete guard.
 * @returns True when neither another save nor a delete owns the screen.
 */
function canSave(
  connection: Session | null,
  saveInFlight: RefObject<boolean>,
  removing: RefObject<boolean>,
): connection is Session {
  return connection !== null && !saveInFlight.current && !removing.current;
}

/**
 * Derives the error lines from a failed save.
 * @param result - The importer's response.
 * @returns A non-empty list of messages.
 */
function errorsFor(result: SaveResult): string[] {
  return result.errors?.length ? result.errors : [result.error ?? 'Save failed.'];
}

/**
 * Builds the message for a save that never reached a verdict.
 * @param error - The caught error value.
 * @returns One user-facing line.
 */
function saveFailure(error: unknown): string[] {
  return [
    reportedOrFallback(
      error instanceof Error ? error.message : undefined,
      'Save failed. Check your connection and try again.',
    ),
  ];
}

/**
 * Closes the banks editor through the same confirmation path as the model.
 * @param options - The selected id, saved and draft configs, and callbacks.
 */
export function closeBanksEditor(options: CloseBanksEditorOptions): void {
  closeBankEditor({
    selected: options.selected,
    baseline: options.baseline,
    config: options.config,
    saving: options.saving,
    setConfig: options.setConfig,
    clearErrors: () => {
      options.setSaveErrors(null);
    },
    close: () => {
      options.setSelected(null);
    },
  });
}

/** What closing the banks editor needs from the hook. */
export interface CloseBanksEditorOptions {
  /** The bank being edited. */
  readonly selected: string | null;
  /** The config as loaded from the importer. */
  readonly baseline: ConfigObject | null;
  /** The config currently being edited. */
  readonly config: ConfigObject;
  /** Whether a save is in flight. */
  readonly saving: boolean;
  /** Replaces the draft config. */
  readonly setConfig: (config: ConfigObject) => void;
  /** Clears the previous validation message. */
  readonly setSaveErrors: (errors: string[] | null) => void;
  /** Returns to the bank list. */
  readonly setSelected: (id: string | null) => void;
}

/** What deleting a bank needs to report back to the screen. */
interface RemoveBankOptions {
  /** The active session, or null when signed out. */
  readonly connection: Session | null;
  /** The bank id to delete. */
  readonly id: string;
  /** Called after the importer confirms the deletion. */
  readonly onRemoved: () => void;
  /** Called with a message the screen can render. */
  readonly onError: (message: string) => void;
}

/**
 * Deletes a bank and reports the outcome to the screen.
 * @param options - The session, the bank id, and the result callbacks.
 */
/** What removing a bank needs while it owns the screen. */
export interface RemoveBankWithGuardsOptions {
  /** The active session, or null when signed out. */
  readonly connection: Session | null;
  /** The bank id to remove. */
  readonly id: string;
  /** Guards against a save running underneath the delete. */
  readonly saveInFlight: RefObject<boolean>;
  /** Guards against a second delete. */
  readonly removing: RefObject<boolean>;
  /** Reports the delete-owned state for the spinner/notice. */
  readonly setRemoving: (removing: boolean) => void;
  /** Reports a delete failure without replacing the whole screen. */
  readonly setSaveErrors: (errors: string[] | null) => void;
  /** Reloads the list after success. */
  readonly onRemoved: () => void;
}

/**
 * Removes a bank while keeping save and delete from overlapping.
 * @param options - The session, id, guards, and screen callbacks.
 */
export async function removeBankWithGuards(options: RemoveBankWithGuardsOptions): Promise<void> {
  const { saveInFlight, removing, setRemoving, setSaveErrors } = options;
  if (saveInFlight.current || removing.current) {
    return;
  }
  removing.current = true;
  setRemoving(true);
  setSaveErrors(null);
  try {
    await removeBankFromImporter({
      connection: options.connection,
      id: options.id,
      onRemoved: options.onRemoved,
      onError: (message) => {
        setSaveErrors([message]);
      },
    });
  } finally {
    removing.current = false;
    setRemoving(false);
  }
}

/**
 * Removes one bank through the importer's DELETE endpoint.
 * @param options - The session, bank id, and result callbacks.
 */
export async function removeBankFromImporter(options: RemoveBankOptions): Promise<void> {
  const { connection, id, onRemoved, onError } = options;
  if (!connection) {
    return;
  }
  try {
    const result = await removeBank(connection, id);
    if (result.ok) {
      haptics.success();
      onRemoved();
    } else {
      onError(result.error ?? 'Could not remove the bank.');
    }
  } catch {
    onError('Could not remove the bank. Check your connection and try again.');
  }
}
