/**
 * Guard test for the `overrides` in `package.json`.
 *
 * An override applies only while the package it names is in the tree. Once an
 * upstream release drops that package, or moves it to another major line, the
 * entry stays in `package.json`, changes nothing and still reads as a live
 * security fix. This proves every override landed on a resolved version in the
 * lockfile and, for a major-scoped key, that a parent still requests that
 * major and resolves the replacement. A stale one fails here and gets removed.
 */
import { intersects, satisfies } from 'semver';

import manifest from '../../package.json';
import lockfile from '../../package-lock.json';

/** A lockfile `packages` entry: the resolved version and the ranges it asks for. */
interface LockEntry {
  readonly version?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

/** The package an override key targets, optionally narrowed to one major line. */
interface OverrideTarget {
  readonly name: string;
  readonly major?: number;
}

const NODE_MODULES = 'node_modules/';

/**
 * Tells whether a resolved version satisfies the range an override installs.
 *
 * `semver` excludes prereleases from a stable range by default, so
 * `8.6.0-rc.1` does not satisfy `^8.5.18` while `8.6.0` does - the same rule
 * npm applies when it resolves the override.
 * @param version - The resolved version from the lockfile.
 * @param range - The override value, such as `^11.0.9`.
 * @returns True when the version is inside the range.
 */
function satisfiesOverrideRange(version: string, range: string): boolean {
  return satisfies(version, range);
}

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
 * Tells whether a lockfile entry proves an override landed.
 * @param target - The parsed override key.
 * @param range - The version range the override installs.
 * @param candidate - The entry's package name and lockfile record.
 * @returns True when the names match and the resolved version is in range.
 */
function isTargeted(
  target: OverrideTarget,
  range: string,
  candidate: { readonly name: string; readonly entry: LockEntry },
): boolean {
  if (candidate.name !== target.name) {
    return false;
  }
  if (candidate.entry.version === undefined) {
    throw new Error(`${candidate.name} has no resolved version`);
  }
  return satisfiesOverrideRange(candidate.entry.version, range);
}

/**
 * Reads the ranges an entry requests for a package.
 * @param entry - The lockfile entry.
 * @param name - The package name.
 * @returns Every range declared in dependencies, devDependencies, optionalDependencies, or peerDependencies.
 */
function dependencyRanges(entry: LockEntry, name: string): string[] {
  const fields = [
    entry.dependencies,
    entry.devDependencies,
    entry.optionalDependencies,
    entry.peerDependencies,
  ];
  return fields.flatMap((deps) => {
    const range = deps?.[name];
    return range === undefined ? [] : [range];
  });
}

/**
 * Tells whether a range can produce a version on the selected major.
 *
 * `intersects` handles carets, tildes, comparator sets such as
 * `>10.2.6 <11.0.0`, and `||` lists, so a parent that still asks for major 10
 * is recognised regardless of how its range is written.
 * @param range - A semver range from a parent's dependency map.
 * @param major - The selected major line.
 * @returns True when the range intersects that major.
 */
function requestsMajor(range: string, major: number): boolean {
  return intersects(range, `${String(major)}.x`);
}

/**
 * Resolves a dependency from a parent's position the way Node does: the
 * nearest nested `node_modules`, then each ancestor, then the root.
 * @param packages - The lockfile `packages` map.
 * @param parentPath - The parent's lockfile key (`''` for the root package).
 * @param name - The dependency name.
 * @returns The resolved lockfile key, or undefined when nothing provides it.
 */
function resolveDependencyPath(
  packages: Readonly<Record<string, LockEntry>>,
  parentPath: string,
  name: string,
): string | undefined {
  let base = parentPath;
  for (;;) {
    const candidate = base === '' ? `${NODE_MODULES}${name}` : `${base}/${NODE_MODULES}${name}`;
    if (Object.hasOwn(packages, candidate)) {
      return candidate;
    }
    const marker = base.lastIndexOf(NODE_MODULES);
    if (marker === -1) {
      return undefined;
    }
    base = marker === 0 ? '' : base.slice(0, marker - 1);
  }
}

/** The dependency an override installs, as a resolved path needs it. */
interface OverrideDependency {
  /** The package name. */
  readonly name: string;
  /** The version range the override installs. */
  readonly range: string;
}

/**
 * Tells whether the copy a qualifying parent actually resolves is in the
 * override's range.
 * @param packages - The lockfile `packages` map.
 * @param parentPath - The parent's lockfile key.
 * @param dependency - The package name and the range the override installs.
 * @returns True when the parent's resolved copy satisfies the range.
 */
function satisfiesResolvedDependency(
  packages: Readonly<Record<string, LockEntry>>,
  parentPath: string,
  dependency: OverrideDependency,
): boolean {
  const resolvedPath = resolveDependencyPath(packages, parentPath, dependency.name);
  if (resolvedPath === undefined) {
    return false;
  }
  const version = packages[resolvedPath].version;
  if (version === undefined) {
    throw new Error(`${dependency.name} has no resolved version`);
  }
  return satisfiesOverrideRange(version, dependency.range);
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
  const entries = Object.entries(packages);
  const installed = entries.flatMap(([path, entry]) => {
    const name = packageName(path);
    return name === undefined ? [] : [{ name, entry }];
  });
  return Object.entries(overrides)
    .filter(([key, value]) => {
      if (typeof value !== 'string') {
        throw new TypeError(`Override "${key}" is nested; only version ranges are checked`);
      }
      const target = parseOverrideKey(key);
      const { major } = target;
      const dependency: OverrideDependency = { name: target.name, range: value };
      if (major !== undefined) {
        const applied = entries.some(([path, entry]) => {
          if (packageName(path) === target.name) {
            return false;
          }
          return dependencyRanges(entry, target.name).some(
            (range) =>
              requestsMajor(range, major) &&
              satisfiesResolvedDependency(packages, path, dependency),
          );
        });
        if (!applied) {
          return true;
        }
      }
      return !installed.some((candidate) => isTargeted(target, value, candidate));
    })
    .map(([key]) => key);
}

describe('package.json overrides', () => {
  it('lands every override on a locked version', () => {
    const packages: Readonly<Record<string, LockEntry>> = lockfile.packages;
    expect(findInertOverrides(manifest.overrides, packages)).toEqual([]);
  });
});

describe('satisfiesOverrideRange', () => {
  it('accepts a stable release inside the range', () => {
    expect(satisfiesOverrideRange('8.6.0', '^8.5.18')).toBe(true);
  });

  it('rejects a prerelease the stable range does not include', () => {
    expect(satisfiesOverrideRange('8.6.0-rc.1', '^8.5.18')).toBe(false);
  });
});

describe('requestsMajor', () => {
  it('recognises a caret range on the selected major', () => {
    expect(requestsMajor('^10.2.6', 10)).toBe(true);
    expect(requestsMajor('^10.2.6', 11)).toBe(false);
  });

  it('recognises a comparator set', () => {
    expect(requestsMajor('>10.2.6 <11.0.0', 10)).toBe(true);
    expect(requestsMajor('>10.2.6 <11.0.0', 11)).toBe(false);
  });

  it('recognises a union that still names the major', () => {
    expect(requestsMajor('^9.0.3 || ^10.1.2 || ^11.0.1', 10)).toBe(true);
  });

  it('rejects a range that starts after the major', () => {
    expect(requestsMajor('>=11.0.0', 10)).toBe(false);
  });
});

describe('findInertOverrides', () => {
  it('accepts an override for a hoisted package', () => {
    const packages = { 'node_modules/postcss': { version: '8.5.29' } };
    expect(findInertOverrides({ postcss: '^8.5.18' }, packages)).toEqual([]);
  });

  it('accepts a major-scoped override while a parent still requests that major', () => {
    const packages = {
      'node_modules/parent': {
        version: '1.0.0',
        dependencies: { 'brace-expansion': '^5.0.0' },
      },
      'node_modules/parent/node_modules/brace-expansion': { version: '5.0.12' },
      'node_modules/brace-expansion': { version: '1.1.21' },
    };
    expect(findInertOverrides({ 'brace-expansion@5': '^5.0.8' }, packages)).toEqual([]);
  });

  it('accepts an override when the qualifying parent resolves the replacement', () => {
    const packages = {
      'node_modules/parent': { version: '1.0.0', dependencies: { minimatch: '^10.2.6' } },
      'node_modules/parent/node_modules/minimatch': { version: '11.0.9' },
      'node_modules/glob/node_modules/minimatch': { version: '11.0.9' },
    };
    expect(findInertOverrides({ 'minimatch@10': '^11.0.9' }, packages)).toEqual([]);
  });

  it('flags an override when the qualifying parent resolves the old copy', () => {
    const packages = {
      'node_modules/parent': { version: '1.0.0', dependencies: { minimatch: '^10.2.6' } },
      'node_modules/parent/node_modules/minimatch': { version: '10.2.6' },
      'node_modules/glob': { version: '14.0.6', dependencies: { minimatch: '^11.0.5' } },
      'node_modules/glob/node_modules/minimatch': { version: '11.0.9' },
    };
    expect(findInertOverrides({ 'minimatch@10': '^11.0.9' }, packages)).toEqual(['minimatch@10']);
  });

  it('recognises a comparator range on the selected major', () => {
    const packages = {
      'node_modules/parent': {
        version: '1.0.0',
        dependencies: { minimatch: '>10.2.6 <11.0.0' },
      },
      'node_modules/parent/node_modules/minimatch': { version: '11.0.9' },
    };
    expect(findInertOverrides({ 'minimatch@10': '^11.0.9' }, packages)).toEqual([]);
  });

  it('rejects a prerelease the override range does not include', () => {
    const packages = {
      'node_modules/parent': { version: '1.0.0', dependencies: { minimatch: '^10.2.6' } },
      'node_modules/parent/node_modules/minimatch': { version: '11.0.9-rc.1' },
    };
    expect(findInertOverrides({ 'minimatch@10': '^11.0.9' }, packages)).toEqual(['minimatch@10']);
  });

  it('accepts the stable release of the same version', () => {
    const packages = {
      'node_modules/parent': { version: '1.0.0', dependencies: { minimatch: '^10.2.6' } },
      'node_modules/parent/node_modules/minimatch': { version: '11.0.9' },
    };
    expect(findInertOverrides({ 'minimatch@10': '^11.0.9' }, packages)).toEqual([]);
  });

  it('flags a major-scoped override after every parent moved off that major', () => {
    const packages = {
      'node_modules/parent': { version: '1.0.0', dependencies: { minimatch: '^11.0.5' } },
      'node_modules/minimatch': { version: '11.0.9' },
    };
    expect(findInertOverrides({ 'minimatch@10': '^11.0.9' }, packages)).toEqual(['minimatch@10']);
  });

  it('accepts a parent range that still names the old major among several', () => {
    const packages = {
      'node_modules/parent': {
        version: '1.0.0',
        dependencies: { minimatch: '^9.0.3 || ^10.1.2 || ^11.0.1' },
      },
      'node_modules/minimatch': { version: '11.0.9' },
    };
    expect(findInertOverrides({ 'minimatch@10': '^11.0.9' }, packages)).toEqual([]);
  });

  it('counts a dependency of the root package as a consumer', () => {
    const packages = {
      '': { version: '1.0.0', devDependencies: { minimatch: '^10.2.6' } },
      'node_modules/minimatch': { version: '11.0.9' },
    };
    expect(findInertOverrides({ 'minimatch@10': '^11.0.9' }, packages)).toEqual([]);
  });

  it('accepts a cross-major override once the replacement is in the lock', () => {
    const packages = {
      'node_modules/parent': { version: '1.0.0', dependencies: { minimatch: '^10.2.6' } },
      'node_modules/minimatch': { version: '11.0.9' },
    };
    expect(findInertOverrides({ 'minimatch@10': '^11.0.9' }, packages)).toEqual([]);
  });

  it('flags a cross-major override whose replacement did not land', () => {
    const packages = {
      'node_modules/parent': { version: '1.0.0', dependencies: { minimatch: '^10.2.6' } },
      'node_modules/minimatch': { version: '11.0.8' },
    };
    expect(findInertOverrides({ 'minimatch@10': '^11.0.9' }, packages)).toEqual(['minimatch@10']);
  });

  it('flags a caret override that the lockfile is below', () => {
    const packages = { 'node_modules/katex': { version: '0.16.47' } };
    expect(findInertOverrides({ katex: '^0.19.1' }, packages)).toEqual(['katex']);
  });

  it('accepts a zero-major caret override on the same minor line', () => {
    const packages = { 'node_modules/katex': { version: '0.19.1' } };
    expect(findInertOverrides({ katex: '^0.19.1' }, packages)).toEqual([]);
  });

  it('flags a zero-major caret override that crossed the minor line', () => {
    const packages = { 'node_modules/katex': { version: '0.20.0' } };
    expect(findInertOverrides({ katex: '^0.19.1' }, packages)).toEqual(['katex']);
  });

  it('flags a major-scoped override when no entry is on that line', () => {
    const packages = {
      'node_modules/parent': { version: '1.0.0', dependencies: { 'brace-expansion': '^2.1.2' } },
      'node_modules/brace-expansion': { version: '1.1.21' },
    };
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
    const packages = {
      'node_modules/parent': { version: '1.0.0', dependencies: { '@scope/pkg': '^2.3.0' } },
      'node_modules/@scope/pkg': { version: '2.3.4' },
    };
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
    const packages = {
      'node_modules/parent': { version: '1.0.0', dependencies: { 'brace-expansion': '^1.1.0' } },
      'node_modules/brace-expansion': {},
    };
    expect(() => findInertOverrides({ 'brace-expansion@1': '^1.1.16' }, packages)).toThrow(
      'brace-expansion has no resolved version',
    );
  });
});
