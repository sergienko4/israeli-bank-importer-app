#!/usr/bin/env node
/**
 * Lists the open SonarCloud issues for this project from the command line, so a
 * finding can be inspected and reproduced locally instead of only in the web UI.
 *
 * Usage:
 *
 *     npm run sonar:issues                 # all open issues
 *     npm run sonar:issues -- --rule typescript:S4782
 *     npm run sonar:issues -- --key AZ-wO2IoSjFqP5YuJfzO
 *
 * Public projects need no credentials. For a private project export a token
 * (`SONAR_TOKEN`); it is sent as a bearer header and never printed.
 *
 * A full analysis is a separate command: `npm run sonar` (SonarScanner CLI).
 */
import process from 'node:process';

const HOST = process.env.SONAR_HOST_URL ?? 'https://sonarcloud.io';
const PROJECT = process.env.SONAR_PROJECT_KEY ?? 'sergienko4_israeli-bank-importer-app';
const PAGE_SIZE = 200;

/**
 * Reads a repeatable `--flag value` pair from argv.
 * @param {string} flag - Flag name, including leading dashes.
 * @returns {string[]} Every value supplied for the flag.
 */
function argValues(flag) {
  const argv = process.argv.slice(2);
  return argv.flatMap((value, index) => (argv[index - 1] === flag ? [value] : []));
}

/**
 * Builds the issue-search URL for the requested filters.
 * @param {number} page - 1-based page index.
 * @returns {string} The absolute request URL.
 */
function searchUrl(page) {
  const url = new URL('/api/issues/search', HOST);
  url.searchParams.set('componentKeys', PROJECT);
  url.searchParams.set('issueStatuses', 'OPEN,CONFIRMED');
  url.searchParams.set('ps', String(PAGE_SIZE));
  url.searchParams.set('p', String(page));
  const rules = argValues('--rule');
  const keys = argValues('--key');
  if (rules.length > 0) url.searchParams.set('rules', rules.join(','));
  if (keys.length > 0) url.searchParams.set('issues', keys.join(','));
  return url.toString();
}

/**
 * Fetches one page of issues.
 * @param {number} page - 1-based page index.
 * @returns {Promise<{issues: object[], paging: {total: number}}>} The API payload.
 */
async function fetchPage(page) {
  const token = process.env.SONAR_TOKEN;
  const response = await fetch(searchUrl(page), {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new Error(`SonarCloud returned ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/**
 * Formats one issue as a single grep-friendly line.
 * @param {object} issue - An issue from the search API.
 * @returns {string} The formatted line.
 */
function formatIssue(issue) {
  const path = String(issue.component).split(':').pop();
  return `${path}:${issue.line ?? 0}  ${issue.rule}  ${issue.message}  [${issue.key}]`;
}

/**
 * Prints every matching open issue and exits non-zero when any exist.
 * @returns {Promise<void>} Resolves once the report is written.
 */
async function main() {
  const issues = [];
  for (let page = 1; ; page += 1) {
    // Sequential by necessity: paging stops only once the running total is known.
    const body = await fetchPage(page);
    issues.push(...body.issues);
    if (issues.length >= body.paging.total || body.issues.length === 0) break;
  }

  if (issues.length === 0) {
    console.log(`No open SonarCloud issues for ${PROJECT}.`);
    return;
  }
  for (const issue of issues) console.log(formatIssue(issue));
  console.log(`\n${issues.length} open issue(s). Reproduce locally with: npm run lint`);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
