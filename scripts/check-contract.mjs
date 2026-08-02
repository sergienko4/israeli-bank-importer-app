/**
 * Proves the vendored API contract still matches the importer.
 *
 * `src/api/generated/` holds a byte-identical copy of the importer's
 * `src/Contract/`. That copy is what the whole app compiles against, so if the
 * importer changes a payload and this copy is not updated, the app keeps
 * believing a shape the server no longer sends — the exact drift this contract
 * exists to stop, just moved one step later.
 *
 * So the copy is compared against the importer at the revision pinned below.
 * A difference fails the build and names the file.
 *
 * That revision, the repository and the module list are all constants here,
 * not data read back from the directory being checked. Nothing the check
 * fetches is decided by a file it could have just written. Updating the
 * contract means editing this file, which arrives the way any other change
 * does — in a pull request.
 *
 * Usage:
 *   node scripts/check-contract.mjs            fail on any difference
 *   node scripts/check-contract.mjs --write    pull the pinned revision in
 */

import { lstatSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Where the vendored copy lives. Nothing outside this directory is written. */
const DIR = join(process.cwd(), 'src', 'api', 'generated');

/** The importer this app is built against. */
const REPO = 'sergienko4/israeli-bank-scrapers-to-actual-budget';

/**
 * The importer commit this copy was taken from.
 *
 * A commit rather than a branch: a branch can be force-pushed underneath the
 * copy, which would change the contract this app is held to without changing a
 * line of it.
 */
const REF = 'fa4c2287e5230cd99de9ba8006652ee522c22b76';

/** The importer release that commit belongs to. */
const IMPORTER_VERSION = '1.41.0';

/** The contract, module by module. */
const FILES = [
  'AppAuth.ts',
  'Common.ts',
  'Config.ts',
  'Devices.ts',
  'Manifest.ts',
  'Otp.ts',
  'Status.ts',
];

/** A contract module: a bare filename, so no path can be traversed. */
const FILE = /^[A-Za-z][A-Za-z0-9]*\.ts$/u;

/** How long to wait for the importer before giving up. */
const FETCH_TIMEOUT_MS = 15_000;

const shouldWrite = process.argv.includes('--write');

/**
 * Fetches one contract module from the importer at the pinned revision.
 * @param {string} name - File name within the importer's src/Contract.
 * @returns {Promise<string>} The file's contents.
 */
async function fetchUpstream(name) {
  const url = `https://raw.githubusercontent.com/${REPO}/${REF}/src/Contract/${name}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`Could not read ${name} from ${REPO}@${REF}: HTTP ${res.status}`);
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
  const pinned = new Set(FILES);
  return readdirSync(DIR)
    .filter((name) => FILE.test(name) && name !== 'index.ts')
    .filter((name) => !pinned.has(name));
}

/**
 * Fetches every pinned module before any is written, so a fetch that fails
 * partway cannot leave a half-updated directory behind.
 *
 * The update itself is not atomic: modules are written, then unlisted ones
 * removed, one file at a time. A crash midway leaves a mixed revision — which
 * `contract:check` reports, as drift or as an unlisted module, and re-running
 * the sync resolves. Being detectable is the whole guarantee; no more is
 * claimed.
 * @returns {Promise<Map<string, string>>} Upstream contents by file name.
 */
async function fetchAll() {
  const entries = await Promise.all(FILES.map(async (name) => [name, await fetchUpstream(name)]));
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
 * Removes a module the contract no longer includes.
 *
 * Only ever reached under `--write`, and only for a name `unlistedFiles()`
 * returned — which excludes this project's own barrel and anything that is not
 * a contract module. Without this, `contract:sync` could not resolve what
 * `contract:check` reports, and its own advice would loop.
 * @param {string} name - File name within the vendored directory.
 * @returns {void}
 */
function deleteModule(name) {
  assertPlainFile(name);
  rmSync(join(DIR, name));
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
    `The vendored contract no longer matches ${REPO}@${REF}:\n` +
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
  const drifted = FILES.filter((name) => normalise(upstream.get(name)) !== readLocal(name));
  const unlisted = unlistedFiles();
  if (shouldWrite) {
    for (const [name, text] of upstream) writeModule(name, text);
    for (const name of unlisted) deleteModule(name);
    console.log(`Contract synced from ${REPO}@${REF}.`);
    if (unlisted.length > 0) {
      console.log(`Removed, no longer part of the contract: ${unlisted.join(', ')}`);
    }
  } else if (drifted.length > 0 || unlisted.length > 0) {
    reportDrift(drifted, unlisted);
  } else {
    console.log(`Contract matches ${REPO}@${REF} (importer ${IMPORTER_VERSION}).`);
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
