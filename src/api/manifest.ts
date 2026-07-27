/**
 * Types for the importer's manifest-driven config API. The manifest (served at
 * GET /api/manifest) describes how to render the config JSON, so the native form
 * stays in sync with the importer with no hard-coded schema.
 */

/** The kinds of fields a manifest section can contain. */
export type FieldKind =
  | 'string'
  | 'secret'
  | 'number'
  | 'boolean'
  | 'select'
  | 'date'
  | 'group'
  | 'list';

/** A single field definition within a section. */
export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  options?: string[];
  fields?: FieldDef[];
  required?: boolean;
  help?: string;
  min?: number;
  max?: number;
  showWhen?: { field: string; in: string[] };
}

/** How a section maps onto the config JSON. */
export type SectionKind = 'object' | 'list' | 'bankMap';

/** A top-level manifest section. */
export interface SectionDef {
  key: string;
  label: string;
  kind: SectionKind;
  icon?: string;
  doc?: string;
  help?: string;
  fields?: FieldDef[];
  itemFields?: FieldDef[];
  bankFields?: FieldDef[];
  targetFields?: FieldDef[];
}

/** Per-bank requirements the importer advertises. */
export interface BankRequirement {
  required: string[];
  /**
   * The bank's own optional credential fields, when the importer advertises
   * them. Absent on older importers, in which case the editor scopes to
   * `required` only so no cross-bank field can leak in.
   */
  optional?: string[];
  displayName?: string;
}

/** The full manifest payload. */
export interface Manifest {
  sections: SectionDef[];
  banks: string[];
  bankRequirements: Record<string, BankRequirement>;
}

/** A JSON config object (the importer's merged, masked config). */
export type ConfigObject = Record<string, unknown>;

/** Outcome of a write, carrying the importer's validation errors on failure. */
export interface SaveResult {
  ok: boolean;
  error?: string;
  errors?: string[];
}
