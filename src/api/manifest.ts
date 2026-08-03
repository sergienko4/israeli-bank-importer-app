/**
 * Types for the importer's manifest-driven config API. The manifest (served at
 * GET /api/manifest) describes how to render the config JSON, so the native form
 * stays in sync with the importer with no hard-coded schema.
 *
 * The payload shapes come from the importer's own contract. They are aliased to
 * the names this app already uses, so call sites read the same as before while
 * the definitions are no longer a second, drifting copy.
 */

export type {
  BankRequirement,
  ConfigBody as ConfigObject,
  ManifestField as FieldDef,
  FieldKind,
  ManifestBody as Manifest,
  ManifestSection as SectionDef,
  SectionKind,
} from './generated';

/**
 * Outcome of a write.
 *
 * This one stays local: it is the app's own summary of a request, folding the
 * importer's 200, 400 and 500 replies into a single value a screen can render.
 * The importer has no such concept to declare.
 */
export interface SaveResult {
  ok: boolean;
  error?: string;
  errors?: string[];
  /**
   * The HTTP status behind a failure, where there was one.
   *
   * Present so a caller can tell "the importer judged this and said no" from
   * "the importer never got to judge it". Absent when the failure did not come
   * from a response at all.
   */
  status?: number;
}
