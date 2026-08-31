# Expo HAS CHANGED

Read the exact versioned docs at <https://docs.expo.dev/versions/v57.0.0/> before writing any code.

This app targets **Expo SDK 57**, which pins `expo`, `react`, and `react-native`
to exact versions and moves those pins within its own patch line: 57.0.17 moved
`react-native` from 0.86.2 to 0.86.3. Read the current pins from `package.json`
rather than from this file, change them only through `npx expo install --fix`,
and do not use older SDK docs or examples.

Two things from that upgrade are easy to trip over:

- `expo/fetch` backs `globalThis.fetch` since SDK 56. Call `fetch` directly; do
  not import it.
- `npm` must resolve against `https://registry.npmjs.org/`, which the committed
  `.npmrc` pins. A corporate mirror that lags the public registry reports the
  newest published versions as unpublished and blocks `expo install --fix`.

## Code quality gates

A strict, type-aware ESLint config (`eslint.config.mjs`) plus Prettier and Husky
hooks are enforced. Before committing, keep these green:

- `npm run lint` - strict ESLint, `--max-warnings=0`, **no** `eslint-disable`/`any`/non-null `!`.
- `npm run format:check` - Prettier.
- `npm run lint:md` - markdownlint, same globs and pinned version as the CI job.
- `npm run typecheck` and `npm test`.

Hooks run automatically: **pre-commit** (`lint-staged`), **commit-msg**
(commitlint / Conventional Commits), **pre-push** (`lint:actions`,
`lint:lockfile`, `lint`, `lint:md`, `format:check`, `typecheck`, `test`).
Requires **Node.js 22+**. Every exported symbol needs a JSDoc block.

`lint-staged` has no glob for `.maestro/**`, so the pre-commit hook will not
format those files; `format:check` in the pre-push hook is what catches them.

## CI ownership

Every job runs in GitHub Actions. Each job has exactly one owner — do not add a
second workflow that produces the same artifact, because two systems firing on
one release tag means a double build and two updates racing to the same channel.

EAS Workflows (`.eas/workflows/`) was tried and removed. Publishing an update
only uploads a JavaScript bundle, so it needs no EAS compute, and on the free
plan every EAS job waits for a worker — an observed update job sat over an hour
before starting. The same publish from a GitHub-hosted runner takes about two
minutes and costs nothing: standard runners are free for public repositories.
Do not move a job back to EAS Workflows without a paid plan and a reason that
survives that comparison.

What still runs on EAS infrastructure is the part that genuinely needs it:
`eas build` compiles on EAS builders, so `release-apk.yml` and
`development-build.yml` queue there and are subject to that queue. Everything
else — `release-ota.yml`, `preview-update.yml`, `branch-cleanup.yml` — only
talks to the EAS API from the runner.

Every workflow that touches EAS starts with the same `EXPO_TOKEN` guard step, so
a fork without an Expo account gets a green skip instead of a red run. Keep that
shape when adding one.

Releases are distributed as the APK attached to the GitHub Release. Nothing here
builds or submits a store binary, and nothing should be added that does without
agreeing the distribution channel first.

The EAS project id is committed in `app.json`. It is not a secret — the app
sends it to `u.expo.dev` on every launch — and `owner` already pins the repo to
one Expo account, so nothing is gained by resolving it at build time. A fork
changes both fields together.

`updates.url` is deliberately not committed: each workflow derives it from that
id with `eas update:configure`, so the endpoint cannot drift away from the
project it points at.

## E2E has flows but no runner

`.maestro/` holds two flows and `eas.json` has an `e2e-test` build profile, but
nothing runs them automatically: hosted Maestro runs are an EAS paid-plan
feature. Run them by hand against a device or emulator until the account is
upgraded.
