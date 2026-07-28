/**
 * Resolves the credential fields that belong to a single bank's schema so the
 * banks editor only shows and offers fields valid for that bank, instead of the
 * global field catalog (the source of the cross-bank field leak).
 *
 * The importer's manifest advertises, per bank, the `required` fields and — when
 * available — the `optional` ones. This module scopes the section-level
 * `bankFields` catalog to `required ∪ optional`. When the importer does not
 * advertise `optional` (older importers), it falls back to `required` only, so a
 * field belonging to another bank can never be offered here. This keeps the
 * editor data-driven: there are no hard-coded per-bank field lists in the app.
 */
import type { BankRequirement, FieldDef, SectionDef } from '../api/manifest';

/**
 * Reports the set of field keys a bank is allowed to have, per its advertised
 * requirement: the union of its required and optional keys.
 * @param requirement - The bank's advertised requirement, or undefined.
 * @returns The allowed field keys for the bank.
 */
export function allowedFieldKeys(requirement: BankRequirement | undefined): Set<string> {
  const required = requirement?.required ?? [];
  const optional = requirement?.optional ?? [];
  return new Set<string>([...required, ...optional]);
}

/**
 * Returns the catalog fields that belong to a bank's schema (its required plus
 * its own optional fields), preserving the catalog's declaration order.
 * @param section - The manifest bankMap section holding the field catalog.
 * @param requirement - The bank's advertised requirement, or undefined.
 * @returns The subset of the catalog allowed for the bank.
 */
export function schemaFields(
  section: SectionDef,
  requirement: BankRequirement | undefined,
): FieldDef[] {
  const allowed = allowedFieldKeys(requirement);
  return (section.bankFields ?? []).filter((field) => allowed.has(field.key));
}

/**
 * Returns the schema fields a bank does not yet have — the fields the "Add
 * field" sheet may offer. Scoped to the bank's schema so no cross-bank field is
 * offered.
 * @param section - The manifest bankMap section.
 * @param requirement - The bank's advertised requirement, or undefined.
 * @param bank - The current bank config object.
 * @returns The addable schema fields not already present on the bank.
 */
export function addableFields(
  section: SectionDef,
  requirement: BankRequirement | undefined,
  bank: Record<string, unknown>,
): FieldDef[] {
  return schemaFields(section, requirement).filter((field) => !Object.hasOwn(bank, field.key));
}
