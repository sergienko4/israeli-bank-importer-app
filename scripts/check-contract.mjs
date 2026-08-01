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

import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Where the vendored copy lives. Nothing outside this directory is written. */
const DIR = join(process.cwd(), 'src', 'api', 'generated');

/**
 * The importer this app is built against.
 *
 * Held here rather than in SOURCE.json so no file can decide which host the
 * check talks to. Only the revision and the file names are pinned, and both are
 * path segments matched against the patterns below.
 */
const REPO = 'sergienko4/israeli-bank-scrapers-to-actual-budget';

/** A commit SHA, or a branch name while an importer change is still in review. */
const REF = /^[\w][\w.-]*(?:\/[\w][\w.-]*)*$/u;

/** A contract module: a bare filename, so no path can be traversed. */
const FILE = /^[A-Za-z][A-Za-z0-9]*\.ts$/u;

/** How long to wait for the importer before giving up. */
const FETCH_TIMEOUT_MS = 15_000;

const shouldWrite = process.argv.includes('--write');

/**
 * Reads SOURCE.json and refuses anything that could point somewhere unintended.
 *
 * Types are checked before any string method runs: `RegExp.test` coerces, so a
 * missing `ref` would pass the pattern as the word "undefined" and then throw a
 * TypeError instead of the explanation below.
 * @returns {{ref: string, importerVersion: string, files: string[]}} The pin.
 */
function readSource() {
  const pin = JSON.parse(readFileSync(join(DIR, 'SOURCE.json'), 'utf8'));
  const isUsable =
    typeof pin === 'object' &&
    pin !== null &&
    pin.repo === REPO &&
    typeof pin.ref === 'string' &&
    REF.test(pin.ref) &&
    !pin.ref.includes('..') &&
    Array.isArray(pin.files) &&
    pin.files.length > 0 &&
    pin.files.every((name) => typeof name === 'string' && FILE.test(name));
  if (!isUsable) {
    throw new Error(`SOURCE.json does not describe a usable revision of ${REPO}.`);
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
  const url = `https://raw.githubusercontent.com/${REPO}/${source.ref}/src/Contract/${name}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`Could not read ${name} from ${REPO}@${source.ref}: HTTP ${res.status}`);
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
 *
 * Only a missing file is forgiven. A permission error or an unreadable
 * directory reported as drift would send someone off to fix the contract when
 * the problem is their checkout. A symlink is refused outright, on both sides,
 * so the contract is only ever compared against a real file in this directory.
 * @param {string} name - File name within the vendored directory.
 * @returns {string} The local contents, or an empty string when absent.
 */
function readLocal(name) {
  assertPlainFile(name);
  try {
    return normalise(readFileSync(join(DIR, name), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
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
 * Fetches every pinned module before any is written, so a fetch that fails
 * partway cannot leave a half-updated directory behind.
 *
 * The writes themselves still happen one file at a time: a crash between two
 * of them leaves a mixed revision, which `contract:check` then reports. That is
 * the whole guarantee — no more is claimed.
 * @returns {Promise<Map<string, string>>} Upstream contents by file name.
 */
async function fetchAll() {
  const entries = await Promise.all(
    source.files.map(async (name) => [name, await fetchUpstream(name)]),
  );
  return new Map(entries);
}

/**
 * Refuses a pinned filename that is anything but a plain file or absent.
 *
 * A symlink sitting at one of these names would otherwise be followed: read
 * from somewhere else, or — under `--write` — used to land content fetched over
 * the network outside this directory.
 * @param {string} name - File name within the vendored directory.
 * @returns {void}
 */
function assertPlainFile(name) {
  const existing = lstatSync(join(DIR, name), { throwIfNoEntry: false });
  if (existing && !existing.isFile()) {
    throw new Error(`${name} is not a plain file; refusing to read or write through it.`);
  }
}

/**
 * Writes one module, having first refused a path that is not a plain file.
 * @param {string} name - File name within the vendored directory.
 * @param {string} text - Contents to write.
 * @returns {void}
 */
function writeModule(name, text) {
  assertPlainFile(name);
  writeFileSync(join(DIR, name), text);
}

/**
 * Reports drift and marks the run as failed.
 * @param {string[]} drifted - Modules whose contents no longer match.
 * @param {string[]} unlisted - Modules the contract no longer includes.
 * @returns {void}
 */
function reportDrift(drifted, unlisted) {
  const lines = [
    ...drifted.map((name) => `  - ${name} differs from the importer`),
    ...unlisted.map((name) => `  - ${name} is no longer part of the contract`),
  ];
  console.error(
    `The vendored contract no longer matches ${REPO}@${source.ref}:\n` +
      lines.join('\n') +
      '\n\nRun `npm run contract:sync`, then fix whatever stops compiling.',
  );
  process.exitCode = 1;
}

/**
 * Compares the vendored contract with the importer, or pulls it in.
 * @returns {Promise<void>} Resolves once the outcome has been reported.
 */
async function run() {
  const upstream = await fetchAll();
  const drifted = source.files.filter((name) => normalise(upstream.get(name)) !== readLocal(name));
  const unlisted = unlistedFiles();
  if (shouldWrite) {
    for (const [name, text] of upstream) writeModule(name, text);
    console.log(`Contract synced from ${REPO}@${source.ref}.`);
    if (unlisted.length > 0) {
      console.log(`No longer part of the contract, delete by hand: ${unlisted.join(', ')}`);
    }
  } else if (drifted.length > 0 || unlisted.length > 0) {
    reportDrift(drifted, unlisted);
  } else {
    console.log(`Contract matches ${REPO}@${source.ref} (importer ${source.importerVersion}).`);
  }
}

// Failures are reported as a sentence and an exit code, never as a raised
// error: the fetch leaves a handle open, and letting the process tear down on
// top of it makes libuv assert and buries the message under a stack dump.
try {
  await run();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
