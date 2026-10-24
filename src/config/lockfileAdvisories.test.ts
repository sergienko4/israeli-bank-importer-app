/**
 * Oracle test for Dependabot alerts whose fix is visible only in the lockfile.
 *
 * Every package listed here arrived transitively, so `package-lock.json` is the
 * only place the fix is visible. A later lockfile regeneration that re-hoists an
 * old metro, or an exact pin that drags an old scanner back, would reintroduce a
 * vulnerable version without touching `package.json`. This walks every entry in
 * the lockfile, at any nesting depth, and holds it to the vulnerable ranges of
 * each advisory.
 */
import lockfile from '../../package-lock.json';

/**
 * One vulnerable range of an advisory: from `introduced`, inclusive, or from the
 * first release when it is absent, up to `floor`, the first fixed version. An
 * advisory fixed separately on several major lines has one entry per line, so a
 * patched release on an older line is not held to the newer line's fix.
 */
interface AdvisoryFloor {
  readonly ghsa: string;
  readonly name: string;
  readonly introduced?: string;
  readonly floor: string;
}

/** A lockfile `packages` entry; only the resolved version matters here. */
interface LockEntry {
  readonly version?: string;
}

/** A lockfile entry that resolves below an advisory floor. */
interface Violation {
  readonly ghsa: string;
  readonly path: string;
  readonly version: string;
}

/**
 * Vulnerable ranges per advisory, as GitHub publishes them. GHSA-vwc7-r8mq-g2x9
 * lists no patched version; its vulnerable range ends at 0.6.0 and adm-zip 0.6.1
 * blocks extraction through symlinks, so 0.6.1 is the floor for both adm-zip
 * advisories.
 */
const FLOORS: readonly AdvisoryFloor[] = [
  { ghsa: 'GHSA-7q85-xj36-vmfc', name: 'adm-zip', floor: '0.6.1' },
  { ghsa: 'GHSA-vwc7-r8mq-g2x9', name: 'adm-zip', floor: '0.6.1' },
  { ghsa: 'GHSA-7w5x-hrqm-74c2', name: 'smol-toml', floor: '1.7.1' },
  { ghsa: 'GHSA-5p2g-fcmc-qvqq', name: 'image-size', floor: '2.0.3' },
  { ghsa: 'GHSA-w3rx-r6r6-pgpr', name: 'image-size', floor: '2.0.3' },
];

const NODE_MODULES = 'node_modules/';

/**
 * Parses a plain `major.minor.patch` version. Anything else throws, so an
 * unexpected format fails the test instead of being compared wrongly.
 * @param version - The version string from the lockfile.
 * @returns The three numeric components.
 */
function parseVersion(version: string): readonly [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (match === null) {
    throw new Error(`Cannot compare version "${version}"`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Compares two versions numerically, component by component.
 * @param version - The resolved version.
 * @param floor - The first fixed version.
 * @returns True when `version` is lower than `floor`.
 */
function isBelow(version: string, floor: string): boolean {
  const actual = parseVersion(version);
  const minimum = parseVersion(floor);
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== minimum[index]) {
      return (actual[index] ?? 0) < (minimum[index] ?? 0);
    }
  }
  return false;
}

/**
 * Tells whether a version falls inside one vulnerable range of an advisory.
 * @param version - The resolved version.
 * @param advisory - The vulnerable range.
 * @returns True when `version` is at or above `introduced` and below `floor`.
 */
function isVulnerable(version: string, advisory: AdvisoryFloor): boolean {
  if (advisory.introduced !== undefined && isBelow(version, advisory.introduced)) {
    return false;
  }
  return isBelow(version, advisory.floor);
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
 * Lists every lockfile entry that resolves inside a vulnerable range.
 * @param packages - The lockfile `packages` map.
 * @param floors - The advisory ranges to enforce.
 * @returns One violation per entry and matching range, in lockfile order.
 */
function findViolations(
  packages: Readonly<Record<string, LockEntry>>,
  floors: readonly AdvisoryFloor[],
): Violation[] {
  const violations: Violation[] = [];
  for (const [path, entry] of Object.entries(packages)) {
    const name = packageName(path);
    for (const advisory of floors.filter((floor) => floor.name === name)) {
      if (entry.version === undefined) {
        throw new Error(`${path} has no resolved version`);
      }
      if (isVulnerable(entry.version, advisory)) {
        violations.push({ ghsa: advisory.ghsa, path, version: entry.version });
      }
    }
  }
  return violations;
}

const ADM_ZIP_FLOOR: readonly AdvisoryFloor[] = [
  { ghsa: 'GHSA-7q85-xj36-vmfc', name: 'adm-zip', floor: '0.6.1' },
];

const MARKDOWN_IT_RANGES: readonly AdvisoryFloor[] = [
  { ghsa: 'GHSA-gfr2-rv44-r23c', name: 'markdown-it', introduced: '14.1.0', floor: '14.3.3' },
  { ghsa: 'GHSA-gfr2-rv44-r23c', name: 'markdown-it', introduced: '15.0.0', floor: '15.0.3' },
];

describe('package-lock.json advisory floors', () => {
  it('resolves no locked package inside a vulnerable range', () => {
    const packages: Readonly<Record<string, LockEntry>> = lockfile.packages;
    expect(findViolations(packages, FLOORS)).toEqual([]);
  });
});

describe('findViolations', () => {
  it('flags a hoisted package below its floor', () => {
    const packages = { 'node_modules/adm-zip': { version: '0.6.0' } };
    expect(findViolations(packages, ADM_ZIP_FLOOR)).toEqual([
      { ghsa: 'GHSA-7q85-xj36-vmfc', path: 'node_modules/adm-zip', version: '0.6.0' },
    ]);
  });

  it('flags a nested package below its floor', () => {
    const path = 'node_modules/sonarqube-scanner/node_modules/adm-zip';
    expect(findViolations({ [path]: { version: '0.5.9' } }, ADM_ZIP_FLOOR)).toEqual([
      { ghsa: 'GHSA-7q85-xj36-vmfc', path, version: '0.5.9' },
    ]);
  });

  it('accepts a package exactly at its floor', () => {
    const packages = { 'node_modules/adm-zip': { version: '0.6.1' } };
    expect(findViolations(packages, ADM_ZIP_FLOOR)).toEqual([]);
  });

  it('compares versions numerically rather than as text', () => {
    const packages = { 'node_modules/adm-zip': { version: '0.10.0' } };
    expect(findViolations(packages, ADM_ZIP_FLOOR)).toEqual([]);
  });

  it('accepts a lockfile that no longer contains the package', () => {
    const packages = { '': { version: '1.0.0' }, 'node_modules/metro': { version: '0.84.6' } };
    expect(findViolations(packages, ADM_ZIP_FLOOR)).toEqual([]);
  });

  it('ignores packages that only share a prefix or a scope with the advisory', () => {
    const packages = {
      'node_modules/adm-zip-plus': { version: '0.0.1' },
      'node_modules/@types/adm-zip': { version: '0.5.0' },
    };
    expect(findViolations(packages, ADM_ZIP_FLOOR)).toEqual([]);
  });

  it('accepts a version released before the vulnerable range begins', () => {
    const packages = { 'node_modules/markdown-it': { version: '14.0.0' } };
    expect(findViolations(packages, MARKDOWN_IT_RANGES)).toEqual([]);
  });

  it('flags a version exactly where the vulnerable range begins', () => {
    const packages = { 'node_modules/markdown-it': { version: '15.0.0' } };
    expect(findViolations(packages, MARKDOWN_IT_RANGES)).toEqual([
      { ghsa: 'GHSA-gfr2-rv44-r23c', path: 'node_modules/markdown-it', version: '15.0.0' },
    ]);
  });

  it('accepts a patched release on an older major line', () => {
    const packages = { 'node_modules/markdown-it': { version: '14.3.3' } };
    expect(findViolations(packages, MARKDOWN_IT_RANGES)).toEqual([]);
  });

  it('flags a vulnerable release on an older major line', () => {
    const path = 'node_modules/markdownlint/node_modules/markdown-it';
    expect(findViolations({ [path]: { version: '14.2.0' } }, MARKDOWN_IT_RANGES)).toEqual([
      { ghsa: 'GHSA-gfr2-rv44-r23c', path, version: '14.2.0' },
    ]);
  });

  it('throws on a version it cannot compare', () => {
    const packages = { 'node_modules/adm-zip': { version: '0.6.1-beta.1' } };
    expect(() => findViolations(packages, ADM_ZIP_FLOOR)).toThrow(
      'Cannot compare version "0.6.1-beta.1"',
    );
  });

  it('throws when a matching entry has no resolved version', () => {
    const packages = { 'node_modules/adm-zip': {} };
    expect(() => findViolations(packages, ADM_ZIP_FLOOR)).toThrow(
      'node_modules/adm-zip has no resolved version',
    );
  });
});
