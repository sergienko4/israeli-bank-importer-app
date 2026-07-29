#!/usr/bin/env node
/**
 * Pins — and then keeps pinned — every GitHub Action used by this repository.
 *
 * OpenSSF Scorecard's `Pinned-Dependencies` check requires each `uses:` entry to
 * reference an immutable commit SHA rather than a mutable tag, because a tag can
 * be re-pointed at malicious code after review.
 *
 * Two modes:
 *   - default : assert every `uses:` is `owner/repo@<40-hex> # <version>`, else exit 1.
 *   - `--fix` : resolve each tag through the GitHub API and rewrite the file.
 *
 * `--fix` uses the already-authenticated `gh` CLI, dereferences annotated tag
 * objects down to the commit they point at, and records the most specific
 * matching tag in the trailing comment so Dependabot can bump it later.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GITHUB_DIR = join(REPO_ROOT, '.github');

/** Matches `uses: owner/repo[/sub/path]@ref` plus an optional trailing comment. */
const USES = /^(?<lead>\s*(?:-\s+)?uses:\s*)(?<slug>[\w.-]+\/[\w./-]+)@(?<ref>\S+)(?<tail>.*)$/;
const SHA = /^[\da-f]{40}$/;
const VERSION_COMMENT = /#\s*v?\d/;

/**
 * Splits a file into lines while remembering its line ending, so rewriting a
 * CRLF workflow does not produce a whole-file diff on Windows checkouts.
 *
 * @param file Absolute path to the file to read.
 * @returns The lines (without terminators) and the detected end-of-line string.
 */
function readLines(file) {
  const text = readFileSync(file, 'utf8');
  return { lines: text.split(/\r?\n/), eol: text.includes('\r\n') ? '\r\n' : '\n' };
}

/**
 * Runs a `gh api` call and parses the JSON response.
 *
 * @param path REST path passed to `gh api`, e.g. `repos/actions/checkout/tags`.
 * @returns The decoded JSON body.
 */
function ghApi(path) {
  const raw = execFileSync('gh', ['api', path, '--paginate'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  // `--paginate` concatenates pages as `][`; splice them into one array.
  return JSON.parse(raw.replaceAll(/]\s*\[/g, ','));
}

/**
 * Resolves a tag to the commit SHA it ultimately points at.
 *
 * Lightweight tags point straight at a commit; annotated tags point at a tag
 * object that must be dereferenced one more hop.
 *
 * @param repo `owner/repo` slug.
 * @param tag Tag name such as `v7` or `v2.4.4`.
 * @returns The 40-character commit SHA.
 */
function resolveTagSha(repo, tag) {
  const ref = ghApi(`repos/${repo}/git/ref/tags/${tag}`);
  if (ref.object.type !== 'tag') return ref.object.sha;
  return ghApi(`repos/${repo}/git/tags/${ref.object.sha}`).object.sha;
}

/**
 * Finds the most specific tag name pointing at a commit, e.g. `v7.0.1` rather
 * than the floating major alias `v7`.
 *
 * @param repo `owner/repo` slug.
 * @param sha Commit SHA to match.
 * @param fallback Tag name to use when no more specific tag exists.
 * @returns The most specific tag name available.
 */
function describeTag(repo, sha, fallback) {
  const matches = ghApi(`repos/${repo}/tags`)
    .filter((tag) => tag.commit.sha === sha)
    .map((tag) => tag.name);
  if (matches.length === 0) return fallback;
  return matches.sort(
    (a, b) => b.split('.').length - a.split('.').length || b.length - a.length,
  )[0];
}

/**
 * Rewrites one `uses:` line to a SHA pin, consulting the GitHub API.
 *
 * @param match Regex groups captured from the `uses:` line.
 * @param cache Memo shared across lines so each tag is resolved only once.
 * @returns The pinned replacement line.
 */
function pinLine({ lead, slug, ref, tail }, cache) {
  const repo = slug.split('/').slice(0, 2).join('/');
  const key = `${repo}@${ref}`;
  if (!cache.has(key)) {
    const sha = resolveTagSha(repo, ref);
    cache.set(key, { sha, version: describeTag(repo, sha, ref) });
    console.log(`  resolved ${key} -> ${cache.get(key).sha} (${cache.get(key).version})`);
  }
  const { sha, version } = cache.get(key);
  const note = tail.includes('#') ? tail.replace(/#.*/, `# ${version}`) : ` # ${version}`;
  return `${lead}${slug}@${sha}${note}`;
}

/**
 * Applies the pin transform to a whole workflow file.
 *
 * @param file Absolute path to the workflow YAML file.
 * @param cache Shared tag-resolution memo.
 * @returns Number of lines rewritten.
 */
function fixFile(file, cache) {
  const { lines, eol } = readLines(file);
  let changed = 0;
  const next = lines.map((line) => {
    const match = USES.exec(line);
    if (!match?.groups || SHA.test(match.groups.ref)) return line;
    changed += 1;
    return pinLine(match.groups, cache);
  });
  if (changed > 0) writeFileSync(file, next.join(eol));
  return changed;
}

/**
 * Collects unpinned `uses:` references in a workflow file.
 *
 * @param file Absolute path to the workflow YAML file.
 * @returns One `file:line` description per violation.
 */
function checkFile(file) {
  const violations = [];
  readLines(file).lines.forEach((line, index) => {
    const match = USES.exec(line);
    if (!match?.groups) return;
    const { slug, ref, tail } = match.groups;
    if (!SHA.test(ref)) violations.push(`${file}:${index + 1} ${slug}@${ref} is not a commit SHA`);
    else if (!VERSION_COMMENT.test(tail))
      violations.push(`${file}:${index + 1} ${slug} pin is missing a "# <version>" comment`);
  });
  return violations;
}

/**
 * Lists every YAML file under `.github`, so composite actions in
 * `.github/actions/**` are held to the same pinning rule as the workflows that
 * call them.
 *
 * @returns Absolute paths to all `.yml` / `.yaml` files under `.github`.
 */
function collectYamlFiles() {
  return readdirSync(GITHUB_DIR, { recursive: true, withFileTypes: true })
    .filter((item) => item.isFile() && /\.ya?ml$/.test(item.name))
    .map((item) => join(item.parentPath, item.name));
}

/**
 * Entry point: pins or verifies every workflow and sets the exit code.
 *
 * @returns Nothing; exits non-zero when an unpinned reference remains.
 */
function main() {
  const files = collectYamlFiles();

  if (process.argv.includes('--fix')) {
    const cache = new Map();
    let total = 0;
    for (const file of files) total += fixFile(file, cache);
    console.log(
      `lint:actions --fix - pinned ${total} reference(s) across ${files.length} file(s).`,
    );
  }

  const violations = files.flatMap((file) => checkFile(file));
  if (violations.length > 0) {
    console.error('Unpinned GitHub Actions found (OpenSSF Scorecard: Pinned-Dependencies):');
    for (const violation of violations) console.error(`  ${violation}`);
    console.error('\nRun `npm run lint:actions -- --fix` to pin them automatically.');
    process.exitCode = 1;
    return;
  }
  console.log(`lint:actions - OK, all actions pinned across ${files.length} file(s) in .github.`);
}

main();
