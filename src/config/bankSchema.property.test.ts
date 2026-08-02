/**
 * Property-based tests for per-bank schema scoping (OpenSSF Scorecard: Fuzzing).
 *
 * The invariant under test is the one that fixed the cross-bank field leak: for
 * *any* catalog and *any* advertised requirement, the editor may only ever
 * surface fields the bank itself declares. These properties assert that
 * containment holds across generated inputs, not just the hand-written cases.
 */
import * as fc from 'fast-check';

import { type BankRequirement, type FieldDef, type SectionDef } from '../api/manifest';
import { addableFields, allowedFieldKeys, schemaFields } from './bankSchema';

/** Field keys shared by the catalog and the requirements, so overlap is common. */
const keyArb = fc.constantFrom('username', 'password', 'id', 'card6', 'nationalId', 'foreign');

/**
 * Builds a catalog field for a key.
 * @param key - The field key.
 * @returns A minimal field definition.
 */
function toField(key: string): FieldDef {
  return { key, label: key, kind: 'string' };
}

/** A bankMap section whose catalog holds a unique, ordered set of fields. */
const sectionArb = fc.uniqueArray(keyArb, { maxLength: 6 }).map<SectionDef>((keys) => ({
  key: 'banks',
  label: 'Banks',
  kind: 'bankMap',
  bankFields: keys.map(toField),
}));

/** An advertised requirement, sometimes without the newer `optional` list. */
const requirementArb = fc.oneof(
  fc.constant(undefined),
  fc.record<BankRequirement>({
    displayName: fc.string(),
    required: fc.uniqueArray(keyArb, { maxLength: 3 }),
    optional: fc.oneof(fc.constant(undefined), fc.uniqueArray(keyArb, { maxLength: 3 })),
  }),
);

/** The bank's current config object. */
const bankArb = fc.dictionary(keyArb, fc.string(), { maxKeys: 4 });

describe('bank schema scoping properties', () => {
  it('never surfaces a field outside the bank\u2019s own schema', () => {
    fc.assert(
      fc.property(sectionArb, requirementArb, (section, requirement) => {
        const allowed = allowedFieldKeys(requirement);
        for (const field of schemaFields(section, requirement)) {
          expect(allowed.has(field.key)).toBe(true);
        }
      }),
    );
  });

  it('only returns fields that exist in the catalog', () => {
    fc.assert(
      fc.property(sectionArb, requirementArb, (section, requirement) => {
        const catalog = new Set((section.bankFields ?? []).map((field) => field.key));
        for (const field of schemaFields(section, requirement)) {
          expect(catalog.has(field.key)).toBe(true);
        }
      }),
    );
  });

  it('preserves the catalog declaration order', () => {
    fc.assert(
      fc.property(sectionArb, requirementArb, (section, requirement) => {
        const catalog = (section.bankFields ?? []).map((field) => field.key);
        const result = schemaFields(section, requirement).map((field) => field.key);
        expect(result).toEqual(catalog.filter((key) => result.includes(key)));
      }),
    );
  });

  it('offers nothing at all when the importer advertises no requirement', () => {
    fc.assert(
      fc.property(sectionArb, bankArb, (section, bank) => {
        expect(schemaFields(section, undefined)).toEqual([]);
        expect(addableFields(section, undefined, bank)).toEqual([]);
      }),
    );
  });

  it('offers only schema fields the bank does not already have', () => {
    fc.assert(
      fc.property(sectionArb, requirementArb, bankArb, (section, requirement, bank) => {
        const schema = new Set(schemaFields(section, requirement).map((field) => field.key));
        for (const field of addableFields(section, requirement, bank)) {
          expect(schema.has(field.key)).toBe(true);
          expect(Object.hasOwn(bank, field.key)).toBe(false);
        }
      }),
    );
  });

  it('treats a missing optional list as required-only', () => {
    fc.assert(
      fc.property(fc.uniqueArray(keyArb, { maxLength: 4 }), (required) => {
        expect([...allowedFieldKeys({ displayName: 'Test Bank', required })]).toEqual(required);
      }),
    );
  });
});
