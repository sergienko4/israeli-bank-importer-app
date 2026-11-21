/**
 * Runs one config save while keeping the editor's save state in step.
 *
 * The editor disables its Save button while a request is in flight. A save
 * that rejects — most visibly a request that outlives its deadline — must still
 * clear that state and show why, or the screen is left spinning with no way to
 * retry. This lives outside the screen so the transition can be tested without
 * rendering React Native.
 */

import type { SaveResult } from '../api/manifest';
import { failureMessage, reportedOrFallback } from './errorMessages';

const UNREACHABLE = failureMessage('unreachable').text;

/** The screen state and effects one config save drives. */
export interface ConfigSavePorts {
  /** Sends the save; resolves with the importer's answer. */
  readonly save: () => Promise<SaveResult>;
  /** Reports whether the Save control is busy. */
  readonly setSaving: (saving: boolean) => void;
  /** Reports the messages shown above the form, or clears them. */
  readonly setErrors: (errors: string[] | null) => void;
  /** Runs after the importer accepted the config. */
  readonly onSuccess: () => void;
  /** Runs after the importer refused the config or the request failed. */
  readonly onFailure: () => void;
}

/**
 * Saves the config, then clears the busy state and reports the outcome.
 *
 * A rejected save is turned into the message the banner shows; the timeout
 * keeps its own wording, and anything else falls back to the unreachable
 * message. The busy flag is cleared in a `finally`, so no outcome leaves the
 * Save button loading.
 * @param ports - The request, state setters, and success/failure effects.
 * @returns Once the save settled and the state was updated.
 */
export async function runConfigSave(ports: ConfigSavePorts): Promise<void> {
  ports.setSaving(true);
  ports.setErrors(null);
  try {
    const result = await ports.save();
    if (result.ok) {
      ports.onSuccess();
    } else {
      ports.onFailure();
      ports.setErrors(result.errors ?? [result.error ?? 'Save failed.']);
    }
  } catch (error) {
    ports.onFailure();
    const reported = error instanceof Error ? error.message : undefined;
    ports.setErrors([reportedOrFallback(reported, UNREACHABLE)]);
  } finally {
    ports.setSaving(false);
  }
}
