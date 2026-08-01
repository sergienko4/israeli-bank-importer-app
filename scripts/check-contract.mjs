/**
 * Proves the vendored API contract still matches the importer.
 *
 * `src/api/generated/` holds a byte-identical copy of the importer's
 * `src/Contract/`. That copy is what the whole app compiles against, so if the
 * importer changes a payload and this copy is not updated, the app keeps
 * believing a shape the server no longer sends — the exact drift this contract
 * exists to stop, just moved one step later.
 *
 * So the copy is compared against the importer at the revision pinned in
 * SOURCE.json. A difference fails the build and names the file.
 *
 * SOURCE.json decides which URL is fetched and which paths are written, so
 * every field it carries is checked against a strict pattern first. A change to
 * that file arrives the way any other change does — in a pull request — and
 * this stops one from redirecting the fetch or escaping the directory.
 *
 * Usage:
 *   node scripts/check-contract.mjs            fail on any difference
 *   node scripts/check-contract.mjs --write    pull the pinned revision in
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Where the vendored copy lives. Nothing outside this directory is written. */
const DIR = join(process.cwd(), 'src', 'api', 'generated');

/** `owner/name`, the only shape a GitHub repository reference can take. */
const REPO = /^[\w.-]+\/[\w.-]+$/u;

/** A commit SHA, or a branch name while an importer change is still in review. */
const REF = /^[\w./-]+$/u;

/** A contract module: a bare filename, so no path can be traversed. */
const FILE = /^[A-Za-z][A-Za-z0-9]*\.ts$/u;

/** How long to wait for the importer before giving up. */
const FETCH_TIMEOUT_MS = 15_000;

const shouldWrite = process.argv.includes('--write');

/**
 * Reads SOURCE.json and refuses anything that could point somewhere unintended.
 * @returns {{repo: string, ref: string, importerVersion: string, files: string[]}} The pin.
 */
function readSource() {
  const pin = JSON.parse(readFileSync(join(DIR, 'SOURCE.json'), 'utf8'));
  const isUsable =
    REPO.test(pin.repo) &&
    REF.test(pin.ref) &&
    !pin.ref.includes('..') &&
    Array.isArray(pin.files) &&
    pin.files.length > 0 &&
    pin.files.every((name) => FILE.test(name));
  if (!isUsable) {
    throw new Error('SOURCE.json does not describe a usable contract revision.');
  }
  return pin;
}

const source = readSource();

/**
 * Fetches one contract module from the importer at the pinned revision.
 * @param {string} name - File name within the importer's src/Contract.
 * @returns {Promise<string>} The file's contents.
 */
async function fetchUpstream(name) {
  const url = `https://raw.githubusercontent.com/${source.repo}/${source.ref}/src/Contract/${name}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`Could not read ${name} from ${source.repo}@${source.ref}: HTTP ${res.status}`);
  }
  return await res.text();
}

/**
 * Normalises line endings so a checkout on Windows does not read as drift.
 * @param {string} text - File contents.
 * @returns {string} The contents with LF line endings.
 */
function normalise(text) {
  return text.replace(/\r\n/gu, '\n');
}

/**
 * Reads a vendored module, treating an absent one as empty so a file the
 * importer has added reads as drift instead of crashing the check.
 * @param {string} name - File name within the vendored directory.
 * @returns {string} The local contents, or an empty string when absent.
 */
function readLocal(name) {
  try {
    return normalise(readFileSync(join(DIR, name), 'utf8'));
  } catch {
    return '';
  }
}

/**
 * Names contract modules present locally that the pin does not list. One the
 * importer has removed or renamed would otherwise sit here unchecked, and the
 * app would go on compiling against it.
 * @returns {string[]} Unlisted modules in the vendored directory.
 */
function unlistedFiles() {
  const pinned = new Set(source.files);
  return readdirSync(DIR)
    .filter((name) => FILE.test(name) && name !== 'index.ts')
    .filter((name) => !pinned.has(name));
}

/**
 * Fetches every pinned module before writing any, so an interrupted `--write`
 * cannot leave the directory holding half of one revision and half of another.
 * @returns {Promise<Map<string, string>>} Upstream contents by file name.
 */
async function fetchAll() {
  const entries = await Promise.all(
    source.files.map(async (name) => [name, await fetchUpstream(name)]),
  );
  return new Map(entries);
}

const upstream = await fetchAll();
const drifted = source.files.filter((name) => normalise(upstream.get(name)) !== readLocal(name));
const unlisted = unlistedFiles();

if (shouldWrite) {
  for (const [name, text] of upstream) writeFileSync(join(DIR, name), text);
  console.log(`Contract synced from ${source.repo}@${source.ref}.`);
  if (unlisted.length > 0) {
    console.log(`No longer part of the contract, delete by hand: ${unlisted.join(', ')}`);
  }
} else if (drifted.length > 0 || unlisted.length > 0) {
  const lines = [
    ...drifted.map((name) => `  - ${name} differs from the importer`),
    ...unlisted.map((name) => `  - ${name} is no longer part of the contract`),
  ];
  console.error(
    `The vendored contract no longer matches ${source.repo}@${source.ref}:\n` +
      lines.join('\n') +
      '\n\nRun `npm run contract:sync`, then fix whatever stops compiling.',
  );
  // Not process.exit(1): the fetch leaves a handle open, and tearing the
  // process down on top of it makes libuv assert, burying the message above
  // under a stack dump.
  process.exitCode = 1;
} else {
  console.log(
    `Contract matches ${source.repo}@${source.ref} (importer ${source.importerVersion}).`,
  );
}
