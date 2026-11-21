import { hasUnsavedChanges } from './unsavedChanges';

describe('hasUnsavedChanges', () => {
  it('treats the same object in a different key order as unchanged', () => {
    expect(hasUnsavedChanges({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(false);
  });

  it('detects a changed scalar', () => {
    expect(hasUnsavedChanges({ a: 1 }, { a: 2 })).toBe(true);
  });

  it('detects an added or removed key', () => {
    expect(hasUnsavedChanges({ a: 1 }, { a: 1, b: 2 })).toBe(true);
    expect(hasUnsavedChanges({ a: 1, b: 2 }, { a: 1 })).toBe(true);
  });

  it('detects a changed nested value', () => {
    expect(hasUnsavedChanges({ a: { b: [1, 2] } }, { a: { b: [1, 3] } })).toBe(true);
  });

  it('treats a reordered array as changed because order is user-visible', () => {
    expect(hasUnsavedChanges({ targets: ['a', 'b'] }, { targets: ['b', 'a'] })).toBe(true);
  });

  it('compares primitives directly', () => {
    expect(hasUnsavedChanges('a', 'a')).toBe(false);
    expect(hasUnsavedChanges('a', 'b')).toBe(true);
  });

  it('distinguishes null from an empty object', () => {
    expect(hasUnsavedChanges(null, {})).toBe(true);
  });
});
