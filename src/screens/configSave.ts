/**
 * Persists one Config section and keeps the baseline honest.
 *
 * Kept out of the screen so the request/result rules live in one place and the
 * component stays within the project's function-size cap.
 */
import type { RefObject } from 'react';

import { saveConfig, type Session } from '../api/importerClient';
import type { ConfigObject, SectionDef } from '../api/manifest';
import { reportedOrFallback } from '../lib/errorMessages';
import { haptics } from '../lib/haptics';
import { hasUnsavedChanges } from '../lib/unsavedChanges';

/** What a Config save needs from the screen. */
export interface SaveConfigOptions {
  /** The active session, or null when signed out. */
  readonly connection: Session | null;
  /** The draft snapshot to send. */
  readonly config: ConfigObject;
  /** Reads the latest draft after the request settles. */
  readonly currentConfig: () => ConfigObject;
  /** Guards against a second save in the same tick. */
  readonly saveInFlight: RefObject<boolean>;
  /** Reports the spinner state. */
  readonly setSaving: (saving: boolean) => void;
  /** Reports validation errors. */
  readonly setSaveErrors: (errors: string[] | null) => void;
  /** Replaces the saved baseline after success. */
  readonly setBaseline: (config: ConfigObject) => void;
  /** Closes the editor. */
  readonly setSelected: (section: SectionDef | null) => void;
}

/**
 * Sends one Config section and applies the result.
 * @param options - The session, submitted draft, and screen callbacks.
 */
export async function saveConfigSection(options: SaveConfigOptions): Promise<void> {
  const { connection, config, currentConfig, saveInFlight } = options;
  if (!connection || saveInFlight.current) {
    return;
  }
  saveInFlight.current = true;
  options.setSaving(true);
  options.setSaveErrors(null);
  try {
    const result = await saveConfig(connection, config);
    if (!result.ok) {
      haptics.warning();
      options.setSaveErrors(
        result.errors?.length ? result.errors : [result.error ?? 'Save failed.'],
      );
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
    options.setSaveErrors([
      reportedOrFallback(
        error instanceof Error ? error.message : undefined,
        'Save failed. Check your connection and try again.',
      ),
    ]);
  } finally {
    saveInFlight.current = false;
    options.setSaving(false);
  }
}
