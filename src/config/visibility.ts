/** Evaluates a field's `showWhen` visibility rule against its sibling values. */
import type { FieldDef } from '../api/manifest';

/**
 * Reports whether a field should be shown, honoring its `showWhen` rule: the
 * field is visible when the referenced sibling's current value is one of the
 * listed values (or when there is no rule).
 * @param field - The field definition.
 * @param siblings - The values of the object the field belongs to.
 * @returns True when the field should render.
 */
export function isFieldVisible(field: FieldDef, siblings: Record<string, unknown>): boolean {
  if (!field.showWhen) {
    return true;
  }
  const current = siblings[field.showWhen.field];
  return typeof current === 'string' && field.showWhen.in.includes(current);
}
