/**
 * Selects the manifest sections the config editor can actually edit. Only
 * `object` sections have inline field forms; `bankMap` sections are handled by
 * the dedicated Banks tab and structured `list` sections are edited in the web
 * portal, so both are hidden here instead of opening an empty editor.
 */
import type { Manifest, SectionDef } from '../api/manifest';

/**
 * Returns the sections the config editor should list — the `object` sections.
 * @param manifest - The loaded manifest, or null before it loads.
 * @returns The editable object sections (empty when there is no manifest).
 */
export function editableSections(manifest: Manifest | null): SectionDef[] {
  return (manifest?.sections ?? []).filter((section) => section.kind === 'object');
}
