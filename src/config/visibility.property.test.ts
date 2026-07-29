/**
 * Property-based tests for `showWhen` visibility (OpenSSF Scorecard: Fuzzing).
 *
 * Visibility is driven by importer-supplied manifest data, so the rule must stay
 * total: any sibling value — wrong type, missing, or hostile — has to resolve to
 * a boolean rather than throwing inside a render pass.
 */
import * as fc from 'fast-check';

import { type FieldDef } from '../api/manifest';
import { isFieldVisible } from './visibility';

/** Sibling values a manifest-driven config can realistically hold. */
const siblingValueArb = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
  fc.array(fc.string(), { maxLength: 3 }),
);

/** An arbitrary sibling record, as read from the config object. */
const siblingsArb = fc.dictionary(fc.constantFrom('mode', 'kind', 'other'), siblingValueArb, {
  maxKeys: 3,
});

/**
 * Builds a field definition carrying the given visibility rule.
 * @param showWhen - The rule to attach, or undefined for an always-visible field.
 * @returns A minimal field definition.
 */
function fieldWith(showWhen?: { field: string; in: string[] }): FieldDef {
  return { key: 'target', label: 'Target', kind: 'string', showWhen };
}

describe('isFieldVisible properties', () => {
  it('always shows a field that declares no rule', () => {
    fc.assert(
      fc.property(siblingsArb, (siblings) => {
        expect(isFieldVisible(fieldWith(), siblings)).toBe(true);
      }),
    );
  });

  it('returns a boolean for every sibling shape, never throwing', () => {
    fc.assert(
      fc.property(
        siblingsArb,
        fc.constantFrom('mode', 'kind', 'absent'),
        fc.array(fc.string(), { maxLength: 4 }),
        (siblings, ref, allowed) => {
          const visible = isFieldVisible(fieldWith({ field: ref, in: allowed }), siblings);
          expect(typeof visible).toBe('boolean');
        },
      ),
    );
  });

  it('shows the field exactly when the sibling is a listed string', () => {
    fc.assert(
      fc.property(
        siblingsArb,
        fc.constantFrom('mode', 'kind', 'absent'),
        fc.array(fc.string(), { maxLength: 4 }),
        (siblings, ref, allowed) => {
          const current = siblings[ref];
          const expected = typeof current === 'string' && allowed.includes(current);
          expect(isFieldVisible(fieldWith({ field: ref, in: allowed }), siblings)).toBe(expected);
        },
      ),
    );
  });

  it('hides the field when the rule lists no values', () => {
    fc.assert(
      fc.property(siblingsArb, fc.constantFrom('mode', 'kind'), (siblings, ref) => {
        expect(isFieldVisible(fieldWith({ field: ref, in: [] }), siblings)).toBe(false);
      }),
    );
  });

  it('never matches a non-string sibling, even against a stringified value', () => {
    fc.assert(
      fc.property(fc.oneof(fc.integer(), fc.boolean()), (raw) => {
        const field = fieldWith({ field: 'mode', in: [String(raw)] });
        expect(isFieldVisible(field, { mode: raw })).toBe(false);
      }),
    );
  });
});
