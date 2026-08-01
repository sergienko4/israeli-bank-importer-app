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
 * Usage:
 *   node scripts/check-contract.mjs            fail on any difference
 *   node scripts/check-contract.mjs --write    pull the pinned revision in
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'src', 'api', 'generated');
const source = JSON.parse(readFileSync(join(DIR, 'SOURCE.json'), 'utf8'));
const shouldWrite = process.argv.includes('--write');

/**
 * Fetches one contract file from the importer at the pinned revision.
 * @param {string} name - File name within the importer's src/Contract.
 * @returns {Promise<string>} The file's contents.
 */
async function fetchUpstream(name) {
  const url = `https://raw.githubusercontent.com/${source.repo}/${source.ref}/src/Contract/${name}`;
  const res = await fetch(url);
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
 * Compares every pinned file, writing instead when asked.
 * @returns {Promise<string[]>} Names of files that differ.
 */
async function compareAll() {
  const drifted = [];
  for (const name of source.files) {
    const upstream = await fetchUpstream(name);
    const localPath = join(DIR, name);
    const local = normalise(readFileSync(localPath, 'utf8'));
    if (normalise(upstream) === local) continue;
    if (shouldWrite) writeFileSync(localPath, upstream);
    else drifted.push(name);
  }
  return drifted;
}

const drifted = await compareAll();

if (shouldWrite) {
  console.log(`Contract synced from ${source.repo}@${source.ref}.`);
} else if (drifted.length > 0) {
  console.error(
    `The vendored contract no longer matches ${source.repo}@${source.ref}:\n` +
      drifted.map((name) => `  - ${name}`).join('\n') +
      '\n\nRun `npm run contract:sync`, then fix whatever stops compiling.',
  );
  process.exit(1);
} else {
  console.log(
    `Contract matches ${source.repo}@${source.ref} (importer ${source.importerVersion}).`,
  );
}
