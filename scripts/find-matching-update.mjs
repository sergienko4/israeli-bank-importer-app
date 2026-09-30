/**
 * Finds the production-sms update that belongs to an SMS APK build.
 *
 * `eas update:list --limit` is capped at 50 and `--offset` is its pagination
 * control, so every full page must be followed until the matching release is
 * found or the result set is exhausted.
 *
 * @see https://github.com/expo/eas-cli/blob/417996ade073e00f6c37a8668cc1f867c4fe5799/packages/eas-cli/src/commandUtils/pagination.ts
 */

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The largest page the EAS CLI accepts. */
const PAGE_SIZE = 50;

/** The branch published for SMS auto-read APKs. */
const BRANCH = 'production-sms';

/** SMS APKs are Android-only. */
const PLATFORM = 'android';

/**
 * @typedef {object} UpdateIdentity
 * @property {string} releaseTag - Release message to match.
 * @property {string} buildSha - Git commit to match.
 * @property {string} runtime - Runtime version to match.
 */

/**
 * @typedef {object} UpdateClients
 * @property {(offset: number, limit: number) => string[]} listGroups - Lists one page of group ids.
 * @property {(group: string) => unknown[]} readGroup - Reads every update in one group.
 */

/**
 * Reads one string field from an untrusted EAS response.
 *
 * @param {unknown} value - The value that may carry the field.
 * @param {string} key - The field name.
 * @returns {string | undefined} The field when it is a string.
 */
function readString(value, key) {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const field = value[key];
  return typeof field === 'string' ? field : undefined;
}

/**
 * Reports whether an EAS update is the exact update an APK requires.
 *
 * @param {unknown} update - An item returned by `eas update:view`.
 * @param {UpdateIdentity} identity - The release identity to match.
 * @returns {boolean} Whether every release field matches.
 */
function matchesIdentity(update, identity) {
  return (
    readString(update, 'branch') === BRANCH &&
    readString(update, 'platform') === PLATFORM &&
    readString(update, 'runtimeVersion') === identity.runtime &&
    readString(update, 'message') === identity.releaseTag &&
    readString(update, 'gitCommitHash') === identity.buildSha
  );
}

/**
 * Finds an exact update group across every EAS result page.
 *
 * @param {UpdateIdentity} identity - The release identity to match.
 * @param {UpdateClients} clients - EAS list and view operations.
 * @returns {string | null} The matching group id, or null after the final page.
 */
export function findMatchingUpdate(identity, clients) {
  let offset = 0;
  for (;;) {
    const groups = clients.listGroups(offset, PAGE_SIZE);
    for (const group of groups) {
      if (clients.readGroup(group).some((update) => matchesIdentity(update, identity))) {
        return group;
      }
    }
    if (groups.length < PAGE_SIZE) {
      return null;
    }
    offset += groups.length;
  }
}

/**
 * Runs an EAS command whose stdout is JSON.
 *
 * @param {string[]} arguments_ - Arguments after the `eas` executable.
 * @returns {unknown} The decoded JSON response.
 */
function runEasJson(arguments_) {
  const output = execFileSync('eas', arguments_, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return JSON.parse(output);
}

/**
 * Lists one page of production-sms update groups.
 *
 * @param {string} runtime - Runtime version to filter by.
 * @param {number} offset - First result to request.
 * @param {number} limit - Maximum results to request.
 * @returns {string[]} The group ids in this page.
 */
function listGroups(runtime, offset, limit) {
  const response = runEasJson([
    'update:list',
    '--branch',
    BRANCH,
    '--runtime-version',
    runtime,
    '--platform',
    PLATFORM,
    '--limit',
    String(limit),
    '--offset',
    String(offset),
    '--json',
    '--non-interactive',
  ]);
  if (typeof response !== 'object' || response === null || !Array.isArray(response.currentPage)) {
    throw new Error('eas update:list returned no currentPage array');
  }
  return response.currentPage.map((update) => {
    const group = readString(update, 'group');
    if (group === undefined) {
      throw new Error('eas update:list returned an item without a group id');
    }
    return group;
  });
}

/**
 * Reads an EAS update group.
 *
 * @param {string} group - The update group id.
 * @returns {unknown[]} Every update in the group.
 */
function readGroup(group) {
  const response = runEasJson(['update:view', group, '--json']);
  if (!Array.isArray(response)) {
    throw new Error(`eas update:view ${group} returned a non-array response`);
  }
  return response;
}

/**
 * Reads a required workflow environment value.
 *
 * @param {string | undefined} value - Environment value.
 * @param {string} name - Environment variable name for error reporting.
 * @returns {string} Its non-empty value.
 */
function requiredEnvironment(value, name) {
  if (value === undefined || value === '') {
    throw new Error(`${name} is required`);
  }
  return value;
}

/**
 * Runs the workflow-facing update lookup.
 */
function main() {
  const releaseTag = requiredEnvironment(process.env.RELEASE_TAG, 'RELEASE_TAG');
  const buildSha = requiredEnvironment(process.env.BUILD_SHA, 'BUILD_SHA');
  const runtime = requiredEnvironment(process.env.RUNTIME, 'RUNTIME');
  const group = findMatchingUpdate(
    { releaseTag, buildSha, runtime },
    {
      listGroups: (offset, limit) => listGroups(runtime, offset, limit),
      readGroup,
    },
  );
  if (group === null) {
    throw new Error(
      `No ${BRANCH} update for ${releaseTag} at ${buildSha} with runtime ${runtime}. ` +
        'Publish it with release-ota.yml first.',
    );
  }
  console.log(`Update group ${group} on ${BRANCH} matches this APK.`);
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`::error::Could not verify the SMS update: ${message}`);
    process.exitCode = 1;
  }
}
