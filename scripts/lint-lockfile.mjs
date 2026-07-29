#!/usr/bin/env node
/**
 * Asserts that `package-lock.json` only resolves packages from the public npm
 * registry.
 *
 * Why this exists: developer machines here sit behind a corporate npm mirror
 * (`packagefeedproxy.microsoft.io`), and running `npm install` with that mirror
 * configured bakes internal Azure Artifacts URLs (`*.pkgs.visualstudio.com`)
 * into every `resolved` field. That is bad twice over — CI and external
 * contributors cannot reach those hosts, and a public repository should never
 * advertise internal infrastructure.
 *
 * The fix is to rewrite those hosts back to the public registry:
 *
 *     npm run lint:lockfile -- --fix
 *
 * That only edits the `resolved` field. Versions and `integrity` hashes are
 * untouched, and `integrity` is content-addressed, so the next `npm ci`
 * cryptographically proves each rewritten URL serves the very same tarball.
 *
 * Local installs keep using the mirror because npm's `replace-registry-host`
 * default rewrites public-registry hosts to whatever registry is configured.
 *
 * Run with `--json` to emit a machine-readable summary instead of a report.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCKFILE = join(REPO_ROOT, 'package-lock.json');

/** Only tarballs served by the public npm registry are allowed in the lockfile. */
const ALLOWED_PREFIX = 'https://registry.npmjs.org/';

/** Azure Artifacts serves npm upstreams under `<feed path>/npm/registry/<name>`. */
const MIRROR_PREFIX = /^https:\/\/[^/]+\/\S*?\/npm\/registry\//;

/**
 * Collects every `resolved` URL in the lockfile that is not served by the
 * public npm registry.
 *
 * @param lockfile Parsed `package-lock.json` contents.
 * @returns One entry per offending package, in lockfile order.
 */
function findForeignResolutions(lockfile) {
  const offenders = [];
  for (const [path, entry] of Object.entries(lockfile.packages ?? {})) {
    const resolved = entry?.resolved;
    if (typeof resolved !== 'string' || !resolved.startsWith('https://')) continue;
    if (resolved.startsWith(ALLOWED_PREFIX)) continue;
    offenders.push({ path, host: new URL(resolved).host });
  }
  return offenders;
}

/**
 * Rewrites mirror-hosted `resolved` URLs back to the public npm registry.
 *
 * @param lockfile Parsed `package-lock.json` contents, mutated in place.
 * @returns Number of entries rewritten.
 */
function rewriteToPublicRegistry(lockfile) {
  let rewritten = 0;
  for (const entry of Object.values(lockfile.packages ?? {})) {
    const resolved = entry?.resolved;
    if (typeof resolved !== 'string' || resolved.startsWith(ALLOWED_PREFIX)) continue;
    if (!MIRROR_PREFIX.test(resolved)) continue;
    entry.resolved = resolved.replace(MIRROR_PREFIX, ALLOWED_PREFIX);
    rewritten += 1;
  }
  return rewritten;
}

/**
 * Prints a human-readable failure report grouped by offending host.
 *
 * @param offenders Entries returned by {@link findForeignResolutions}.
 */
function report(offenders) {
  const byHost = new Map();
  for (const { host, path } of offenders) {
    byHost.set(host, [...(byHost.get(host) ?? []), path]);
  }
  console.error(`package-lock.json resolves ${offenders.length} package(s) off the registry:`);
  for (const [host, paths] of [...byHost].sort((a, b) => b[1].length - a[1].length)) {
    console.error(`  ${host}  (${paths.length}) e.g. ${paths[0]}`);
  }
  console.error('\nRewrite them back to the public registry:');
  console.error('  npm run lint:lockfile -- --fix');
}

/**
 * Entry point: validates the lockfile and sets the process exit code.
 *
 * @returns Nothing; exits non-zero when the lockfile is not portable.
 */
function main() {
  const lockfile = JSON.parse(readFileSync(LOCKFILE, 'utf8'));

  if (process.argv.includes('--fix')) {
    const rewritten = rewriteToPublicRegistry(lockfile);
    if (rewritten > 0) writeFileSync(LOCKFILE, `${JSON.stringify(lockfile, undefined, 2)}\n`);
    console.log(`lint:lockfile --fix - rewrote ${rewritten} resolution(s) to ${ALLOWED_PREFIX}`);
  }

  const offenders = findForeignResolutions(lockfile);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ offenders: offenders.length, entries: offenders }, undefined, 2));
  } else if (offenders.length > 0) {
    report(offenders);
  } else {
    const total = Object.keys(lockfile.packages ?? {}).length;
    console.log(`lint:lockfile - OK, all resolutions on ${ALLOWED_PREFIX} (${total} entries).`);
  }

  process.exitCode = offenders.length > 0 ? 1 : 0;
}

main();
