/**
 * Guard test for the `overrides` in `package.json`.
 *
 * An override applies only while the package it names is in the tree. Once an
 * upstream release drops that package, or moves it to another major line, the
 * entry stays in `package.json`, changes nothing and still reads as a live
 * security fix. This holds every override to at least one lockfile entry it
 * would apply to, so a stale one fails here and gets removed.
 */
import manifest from '../../package.json';
import lockfile from '../../package-lock.json';

/** A lockfile `packages` entry; only the resolved version matters here. */
interface LockEntry {
  readonly version?: string;
}

/** The package an override key targets, optionally narrowed to one major line. */
interface OverrideTarget {
  readonly name: string;
  readonly major?: number;
}

const NODE_MODULES = 'node_modules/';

/**
 * Reads the package name from a lockfile key such as
 * `node_modules/a/node_modules/@scope/b`.
 * @param path - The lockfile key.
 * @returns The innermost package name, or undefined for the root entry.
 */
function packageName(path: string): string | undefined {
  const start = path.lastIndexOf(NODE_MODULES);
  return start === -1 ? undefined : path.slice(start + NODE_MODULES.length);
}

/**
 * Parses an override key: a package name, optionally followed by `@` and a
 * major version. npm accepts any range after the `@`, but only these two forms
 * are used here; anything else throws, so a new form has to be handled here
 * before it can pass unchecked.
 * @param key - The key from `overrides`.
 * @returns The package name and, when given, the major line.
 */
function parseOverrideKey(key: string): OverrideTarget {
  const match = /^((?:@[^/@]+\/)?[^/@]+)(?:@(\d+))?$/.exec(key);
  const name = match?.[1];
  if (name === undefined) {
    throw new Error(`Unsupported override key "${key}"`);
  }
  const major = match?.[2];
  return major === undefined ? { name } : { name, major: Number(major) };
}

/**
 * Tells whether a lockfile entry is one an override would apply to.
 * @param target - The parsed override key.
 * @param name - The entry's package name.
 * @param entry - The lockfile entry.
 * @returns True when the names match and, if the key names a major line, the
 * entry's version is on it.
 */
function isTargeted(target: OverrideTarget, name: string, entry: LockEntry): boolean {
  if (name !== target.name) {
    return false;
  }
  if (target.major === undefined) {
    return true;
  }
  if (entry.version === undefined) {
    throw new Error(`${name} has no resolved version`);
  }
  return Number(entry.version.split('.')[0]) === target.major;
}

/**
 * Lists the overrides that no lockfile entry would be subject to.
 * @param overrides - The `overrides` map from `package.json`.
 * @param packages - The lockfile `packages` map.
 * @returns The keys of the inert overrides, in `package.json` order.
 */
function findInertOverrides(
  overrides: Readonly<Record<string, unknown>>,
  packages: Readonly<Record<string, LockEntry>>,
): string[] {
  const installed = Object.entries(packages).flatMap(([path, entry]) => {
    const name = packageName(path);
    return name === undefined ? [] : [{ name, entry }];
  });
  return Object.entries(overrides)
    .filter(([key, value]) => {
      if (typeof value !== 'string') {
        throw new TypeError(`Override "${key}" is nested; only version ranges are checked`);
      }
      const target = parseOverrideKey(key);
      return !installed.some(({ name, entry }) => isTargeted(target, name, entry));
    })
    .map(([key]) => key);
}

describe('package.json overrides', () => {
  it('applies every override to at least one locked package', () => {
    const packages: Readonly<Record<string, LockEntry>> = lockfile.packages;
    expect(findInertOverrides(manifest.overrides, packages)).toEqual([]);
  });
});

describe('findInertOverrides', () => {
  it('accepts an override for a hoisted package', () => {
    const packages = { 'node_modules/postcss': { version: '8.5.29' } };
    expect(findInertOverrides({ postcss: '^8.5.18' }, packages)).toEqual([]);
  });

  it('accepts a major-scoped override for a nested package on that line', () => {
    const packages = {
      'node_modules/brace-expansion': { version: '1.1.21' },
      'node_modules/glob/node_modules/brace-expansion': { version: '5.0.12' },
    };
    expect(findInertOverrides({ 'brace-expansion@5': '^5.0.8' }, packages)).toEqual([]);
  });

  it('flags a major-scoped override when no entry is on that line', () => {
    const packages = { 'node_modules/brace-expansion': { version: '1.1.21' } };
    expect(findInertOverrides({ 'brace-expansion@2': '^2.1.2' }, packages)).toEqual([
      'brace-expansion@2',
    ]);
  });

  it('flags an override for a package the lockfile no longer contains', () => {
    const packages = { '': { version: '1.0.0' }, 'node_modules/postcss': { version: '8.5.29' } };
    expect(findInertOverrides({ tar: '^7.5.21', postcss: '^8.5.18' }, packages)).toEqual(['tar']);
  });

  it('ignores packages that only share a prefix or a scope with the override', () => {
    const packages = {
      'node_modules/tar-fs': { version: '3.0.0' },
      'node_modules/@types/tar': { version: '7.0.0' },
    };
    expect(findInertOverrides({ tar: '^7.5.21' }, packages)).toEqual(['tar']);
  });

  it('reads a scoped package name apart from its major version', () => {
    const packages = { 'node_modules/@scope/pkg': { version: '2.3.4' } };
    expect(findInertOverrides({ '@scope/pkg@2': '^2.3.0' }, packages)).toEqual([]);
    expect(findInertOverrides({ '@scope/pkg@3': '^3.0.0' }, packages)).toEqual(['@scope/pkg@3']);
  });

  it('throws on a key form it does not check', () => {
    const packages = { 'node_modules/postcss': { version: '8.5.29' } };
    expect(() => findInertOverrides({ 'postcss@^8': '^8.5.18' }, packages)).toThrow(
      'Unsupported override key "postcss@^8"',
    );
  });

  it('throws on a nested override', () => {
    const packages = { 'node_modules/postcss': { version: '8.5.29' } };
    expect(() => findInertOverrides({ postcss: { nanoid: '^3.3.8' } }, packages)).toThrow(
      'Override "postcss" is nested; only version ranges are checked',
    );
  });

  it('throws when a major-scoped override meets an entry with no resolved version', () => {
    const packages = { 'node_modules/brace-expansion': {} };
    expect(() => findInertOverrides({ 'brace-expansion@1': '^1.1.16' }, packages)).toThrow(
      'brace-expansion has no resolved version',
    );
  });
});
