/**
 * Fails the build when a bundled module shadows a JavaScript global.
 *
 * A dependency that exports a member named after a global - TypeBox exports
 * `Object` - can end up declaring a module-scoped `var` of that name once the
 * bundler rewrites it to CommonJS. `var` hoists, so the global is `undefined`
 * for the whole module, including the `Object.defineProperty(exports, ...)`
 * line the rewrite puts at the top. The bundle then dies on the first line it
 * runs, before the app registers:
 *
 *   TypeError: Cannot read property 'defineProperty' of undefined
 *   Invariant Violation: "main" has not been registered
 *
 * Nothing else catches this. It typechecks, it bundles, the tests pass, and
 * the app is dead the moment it launches - the fault is in code the bundler
 * wrote, and only a release build runs it. A dependency bump or a Metro
 * upgrade can reintroduce it silently, so the bundle is checked here instead.
 *
 * Usage:
 *   node scripts/check-bundle.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The global whose shadowing kills a module before any of its code runs.
 *
 * Only `Object`: the bundler's own preamble calls `Object.defineProperty` on
 * the module's first line, so a hoisted `var Object` is fatal on sight. Other
 * globals are left out on purpose - a module may legitimately bind a name like
 * `Promise` to a polyfill, and flagging those would make this cry wolf.
 */
const SHADOW = /\bvar (Object) = /gu;

const work = mkdtempSync(join(tmpdir(), 'bundle-check-'));

/**
 * Builds the Android bundle the way a release build does.
 *
 * Unminified on purpose: a minified bundle renames locals, which would hide
 * the very declaration this looks for.
 * @returns {string} The bundle's contents.
 */
function buildBundle() {
  const out = join(work, 'index.android.bundle');
  // Expo's CLI is run through node directly: npx resolves to a .cmd on Windows,
  // which cannot be spawned without a shell.
  execFileSync(
    process.execPath,
    [
      createRequire(import.meta.url).resolve('expo/bin/cli'),
      'export:embed',
      '--platform',
      'android',
      '--dev',
      'false',
      '--entry-file',
      'index.ts',
      '--bundle-output',
      out,
      '--assets-dest',
      join(work, 'assets'),
      '--minify',
      'false',
    ],
    { stdio: 'pipe' },
  );
  return readFileSync(out, 'utf8');
}

try {
  const found = [...buildBundle().matchAll(SHADOW)].map((match) => match[1]);
  if (found.length > 0) {
    console.error(
      `A bundled module shadows the global ${found[0]}.\n` +
        'The bundle will throw before the app registers. Resolve the dependency\n' +
        'to its CommonJS build in metro.config.js, the way @sinclair/typebox is.',
    );
    process.exitCode = 1;
  } else {
    console.log('No bundled module shadows the global Object.');
  }
} catch (error) {
  console.error(`Could not build the bundle to check it: ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
