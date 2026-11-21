/**
 * Compares an editor draft with the value it was loaded from.
 *
 * Config objects come back from the importer with whatever key order the server
 * serialised, and an edit that only recreates the same object would otherwise
 * look dirty. Keys are sorted before comparison so order never matters; array
 * order does, because it is user-visible (targets, list items).
 */

/**
 * Rebuilds a JSON-like value with every object's keys in sorted order.
 * @param value - The value to canonicalise.
 * @returns An equivalent value whose serialisation is stable.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonical(entry));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : 1))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }

  return value;
}

/**
 * Reports whether a draft differs from the value it was loaded from.
 * @param baseline - The saved value, or null while it is still loading.
 * @param draft - The value being edited.
 * @returns True when saving would change something.
 */
export function hasUnsavedChanges(baseline: unknown, draft: unknown): boolean {
  return JSON.stringify(canonical(baseline)) !== JSON.stringify(canonical(draft));
}
