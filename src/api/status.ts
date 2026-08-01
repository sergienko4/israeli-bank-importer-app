/**
 * Types for the importer's redacted import-run status (GET /api/status).
 *
 * These are the importer's own declarations, not this app's guess at them. The
 * hand-written copy they replace was missing `totalDuplicates` and both
 * reconciliation fields, and recorded the unit of `successRate` in a comment —
 * which is how a flawless import once rendered as "10000%". The contract puts
 * that unit in the schema, with a range that makes the wrong reading fail.
 */

export type { RunBank, RunEntry } from './generated';
