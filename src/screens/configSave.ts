/**
 * Persists one Config section and keeps the baseline honest.
 *
 * Kept out of the screen so the request/result rules live in one place and the
 * component stays within the project's function-size cap.
 */
import type { RefObject } from 'react';

import { saveConfig, type Session } from '../api/importerClient';
import type { ConfigObject, SectionDef } from '../api/manifest';
import { runConfigSave } from '../lib/configSave';
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
  try {
    await runConfigSave({
      save: () => saveConfig(connection, config),
      setSaving: options.setSaving,
      setErrors: options.setSaveErrors,
      onSuccess: () => {
        haptics.success();
        options.setBaseline(config);
        if (hasUnsavedChanges(config, currentConfig())) {
          options.setSaveErrors(['Saved, but newer edits are still here. Save again.']);
        } else {
          options.setSelected(null);
        }
      },
      onFailure: () => {
        haptics.warning();
      },
    });
  } finally {
    saveInFlight.current = false;
  }
}
