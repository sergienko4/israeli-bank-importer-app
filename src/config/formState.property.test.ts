/**
 * Property-based tests for the immutable key-path helpers (OpenSSF Scorecard:
 * Fuzzing).
 *
 * `setAtPath` backs every edit in the config editor, so two things must hold for
 * arbitrary paths: what you write is what you read back, and the object handed
 * in is never mutated (React relies on the new reference to re-render).
 */
import * as fc from 'fast-check';

import { getAtPath, setAtPath } from './formState';

/** Realistic config key segments; a small alphabet makes collisions likely. */
const keyArb = fc.constantFrom('alpha', 'beta', 'gamma', 'delta');

/** A non-empty key path, as produced by the section form. */
const pathArb = fc.array(keyArb, { minLength: 1, maxLength: 4 });

/** JSON-safe leaf values the editor can store. */
const valueArb = fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null));

/** Arbitrary nested config objects, shaped like the importer's config JSON. */
const configArb = fc.dictionary(
  keyArb,
  fc.oneof(valueArb, fc.dictionary(keyArb, valueArb, { maxKeys: 3 })),
  { maxKeys: 4 },
);

describe('setAtPath / getAtPath properties', () => {
  it('reads back exactly what it wrote, for every path', () => {
    fc.assert(
      fc.property(configArb, pathArb, valueArb, (config, path, value) => {
        expect(getAtPath(setAtPath(config, path, value), path)).toBe(value);
      }),
    );
  });

  it('never mutates the object it was given', () => {
    fc.assert(
      fc.property(configArb, pathArb, valueArb, (config, path, value) => {
        const before = JSON.stringify(config);
        setAtPath(config, path, value);
        expect(JSON.stringify(config)).toBe(before);
      }),
    );
  });

  it('returns a new root reference so React detects the change', () => {
    fc.assert(
      fc.property(configArb, pathArb, valueArb, (config, path, value) => {
        expect(setAtPath(config, path, value)).not.toBe(config);
      }),
    );
  });

  it('leaves every unrelated top-level key untouched', () => {
    fc.assert(
      fc.property(configArb, pathArb, valueArb, (config, path, value) => {
        const next = setAtPath(config, path, value);
        for (const key of Object.keys(config)) {
          if (key !== path[0]) {
            expect(next[key]).toBe(config[key]);
          }
        }
      }),
    );
  });

  it('treats an empty path as a no-op', () => {
    fc.assert(
      fc.property(configArb, valueArb, (config, value) => {
        expect(setAtPath(config, [], value)).toBe(config);
        expect(getAtPath(config, [])).toBe(config);
      }),
    );
  });

  it('reports undefined for paths that run past a leaf', () => {
    fc.assert(
      fc.property(configArb, pathArb, fc.string(), (config, path, leaf) => {
        const next = setAtPath(config, path, leaf);
        expect(getAtPath(next, [...path, 'missing'])).toBeUndefined();
      }),
    );
  });

  it('does not pollute Object.prototype through a __proto__ segment', () => {
    const next = setAtPath({}, ['__proto__', 'polluted'], 'yes');
    expect(next).toBeDefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
});
