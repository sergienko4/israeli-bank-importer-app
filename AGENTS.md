# Expo HAS CHANGED

Read the exact versioned docs at <https://docs.expo.dev/versions/v54.0.0/> before writing any code.

This app targets **Expo SDK 54** (`expo@~54.0.0`, `react-native@0.81.5`, `react@19.1.0`).
Match that line for every dependency and API - do not use SDK 57 docs or examples.

## Code quality gates

A strict, type-aware ESLint config (`eslint.config.mjs`) plus Prettier and Husky
hooks are enforced. Before committing, keep these green:

- `npm run lint` - strict ESLint, `--max-warnings=0`, **no** `eslint-disable`/`any`/non-null `!`.
- `npm run format:check` - Prettier.
- `npm run lint:md` - markdownlint, same globs and pinned version as the CI job.
- `npm run typecheck` and `npm test`.

Hooks run automatically: **pre-commit** (`lint-staged`), **commit-msg**
(commitlint / Conventional Commits), **pre-push** (`lint:actions`,
`lint:lockfile`, `lint`, `lint:md`, `typecheck`, `test`). Requires
**Node.js 22+**. Every exported symbol needs a JSDoc block.

`lint-staged` has no glob for `.eas/**` or `.maestro/**`, so the pre-commit hook
will not format those files. Run `npm run format:check` before committing them.

## CI ownership

Each job has exactly one owner. Do not add a second workflow that produces the
same artifact — two systems firing on one release tag means a double build and
two updates racing to the same channel.

| Owner | Scope |
| --- | --- |
| `.github/workflows/` | Anything that reads or writes GitHub: quality gates, security scanning, release-please, and attaching the APK to the GitHub Release. |
| `.eas/workflows/` | Anything that only touches EAS: updates, builds, and update-branch cleanup. |

The APK job is the deliberate exception: it lives in GitHub Actions because
uploading a release asset is a GitHub operation, and EAS Workflows has no job
type for it. It is the only GitHub Actions workflow that still needs
`EXPO_TOKEN`.

Releases are distributed as that APK. Nothing here builds or submits a store
binary, and nothing should be added that does without agreeing the distribution
channel first.

Validate any change under `.eas/workflows/` against the real (server-side)
schema before committing:

```powershell
npx --yes eas-cli@latest workflow:validate .eas/workflows/<file>.yml
```

A schema-valid file can still fail at run time. `eas workflow:run <file>` runs it
on EAS without pushing, which is the only way to catch a job whose parameters
resolve to nothing.

Every job here waits for an EAS worker, and on the free plan that queue is long
— an observed update job sat 30 minutes without starting. Publishing an update
from a GitHub runner took about two minutes, so expect the release update to
land well after the APK. That is queue latency, not a broken workflow: check
`eas workflow:view <runId> --json` for `errors` before assuming a job is stuck.

Every `on:` trigger in `.eas/workflows/` depends on the GitHub repository being
connected to the EAS project through the Expo GitHub App. Until that link
exists, those workflows only run from `eas workflow:run`, and a green CLI run
says nothing about whether a push would have triggered them.

The EAS project id is committed in `app.json`. It is not a secret — the app
sends it to `u.expo.dev` on every launch — and `owner` already pins the repo to
one Expo account, so nothing is gained by resolving it at build time. A fork
changes both fields together.

## E2E has flows but no runner

`.maestro/` holds two flows and `eas.json` has an `e2e-test` build profile, but
nothing runs them automatically: the EAS `maestro` job type rejects validation
with "requires a paid plan". Run them by hand against a device or emulator, or
add the workflow once the account is on a paid plan. Do not commit a workflow
that cannot pass `eas workflow:validate`.
