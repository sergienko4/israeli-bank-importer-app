/**
 * Pure helpers for the banks editor's draft state.
 *
 * The editor writes a new bank into the config as soon as the user picks it
 * from the catalog, so the form has a value to render. Backing out has to undo
 * that write, or the list keeps a bank the importer never received. Kept free
 * of React so the restore rules are unit-testable.
 */
import type { ConfigObject } from '../api/manifest';

/** Editable bank configuration values keyed by manifest field id. */
export type BankConfig = Record<string, unknown>;

/**
 * Reads the banks map from a config object.
 * @param config - The full config.
 * @returns The banks keyed by id (empty when the key is absent or malformed).
 */
export function banksOf(config: ConfigObject): Record<string, BankConfig> {
  const banks = config.banks;
  return typeof banks === 'object' && banks !== null ? (banks as Record<string, BankConfig>) : {};
}

/**
 * Reports whether an id exists only in the draft, not in the saved config.
 * @param baseline - The config as loaded from the importer.
 * @param id - The bank id being edited.
 * @returns True when backing out must remove the bank entirely.
 */
export function isNewBankDraft(baseline: ConfigObject, id: string): boolean {
  return !Object.hasOwn(banksOf(baseline), id);
}

/**
 * Formats a bank's target count for display.
 * @param count - How many targets the bank has.
 * @returns A pluralised noun phrase.
 */
export function targetsLabel(count: number): string {
  return `${String(count)} ${count === 1 ? 'target' : 'targets'}`;
}

/**
 * Undoes a bank draft: restores a saved bank, or removes a newly added one.
 * @param baseline - The config as loaded from the importer.
 * @param draft - The config being edited.
 * @param id - The bank id to discard.
 * @returns The draft without the unsaved bank changes.
 */
export function discardBankDraft(
  baseline: ConfigObject,
  draft: ConfigObject,
  id: string,
): ConfigObject {
  const savedBanks = banksOf(baseline);
  const draftBanks = banksOf(draft);
  if (!Object.hasOwn(savedBanks, id) && !Object.hasOwn(draftBanks, id)) {
    return draft;
  }
  const nextBanks = Object.fromEntries(Object.entries(draftBanks).filter(([key]) => key !== id));
  if (Object.hasOwn(savedBanks, id)) {
    // A data property, not an assignment: an importer may legitimately name a
    // bank "__proto__", and assigning that key would replace the prototype.
    Object.defineProperty(nextBanks, id, {
      value: savedBanks[id],
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return { ...draft, banks: nextBanks };
}
