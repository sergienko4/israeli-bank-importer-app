/**
 * Actions the banks editor performs when leaving it: discard a draft, or call
 * the delete endpoint. Kept out of the state hook so each has one reason to
 * change and the hook stays within the project's function-size cap.
 */
import { Alert } from 'react-native';

import { removeBank, type Session } from '../api/importerClient';
import type { ConfigObject } from '../api/manifest';
import { banksOf, discardBankDraft, isNewBankDraft } from '../lib/bankDrafts';
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
