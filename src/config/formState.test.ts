import { getAtPath, setAtPath } from './formState';

describe('getAtPath', () => {
  it('reads a nested value', () => {
    expect(getAtPath({ a: { b: { c: 5 } } }, ['a', 'b', 'c'])).toBe(5);
  });

  it('returns undefined for a missing segment', () => {
    expect(getAtPath({ a: {} }, ['a', 'b', 'c'])).toBeUndefined();
  });

  it('returns the root for an empty path', () => {
    const root = { a: 1 };
    expect(getAtPath(root, [])).toBe(root);
  });
});

describe('setAtPath', () => {
  it('sets a top-level value immutably', () => {
    const before = { a: 1 };
    const after = setAtPath(before, ['a'], 2);
    expect(after).toEqual({ a: 2 });
    expect(before).toEqual({ a: 1 });
  });

  it('sets a nested value and creates missing objects', () => {
    const after = setAtPath({}, ['general', 'proxy', 'host'], 'x');
    expect(after).toEqual({ general: { proxy: { host: 'x' } } });
  });

  it('preserves sibling keys along the path', () => {
    const before = { general: { a: 1, group: { b: 2 } } };
    const after = setAtPath(before, ['general', 'group', 'c'], 3);
    expect(after).toEqual({ general: { a: 1, group: { b: 2, c: 3 } } });
  });

  it('overwrites a non-object segment with a fresh object', () => {
    const after = setAtPath({ a: 5 }, ['a', 'b'], 1);
    expect(after).toEqual({ a: { b: 1 } });
  });
});
