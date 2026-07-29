# Israeli Bank Importer — Mobile Config App

[![CI](https://github.com/sergienko4/israeli-bank-importer-app/actions/workflows/ci.yml/badge.svg)](https://github.com/sergienko4/israeli-bank-importer-app/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/sergienko4/israeli-bank-importer-app/badge)](https://scorecard.dev/viewer/?uri=github.com/sergienko4/israeli-bank-importer-app)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A cross-platform **Expo / React Native** app (iOS + Android) that lets you edit
your **self-hosted [Israeli Bank Importer](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget)**
configuration from your phone — without SSHing into a server or hand-editing
`config.json`.

The app is a **thin, manifest-driven client**: it talks to *your own* importer's
config portal API over a **private network**, so your bank credentials never
leave your machine and never touch a third-party cloud.

> **Companion backend:** this app configures the self-hosted
> [**israeli-bank-scrapers-to-actual-budget**](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget)
> importer — the server that scrapes your banks and imports into
> [Actual Budget](https://actualbudget.org/). You need that importer running
> (with its config portal enabled) to use this app.

## How it works

```text
 ┌─────────────┐   Authorization: Bearer   ┌────────────────────────────┐
 │  This app   │ ──────── private network ─▶ │  Your self-hosted importer │
 │ (phone)     │        (Tailscale / VPN)   │  portal API  /api/*        │
 └─────────────┘ ←────── manifest + config ─ └────────────────────────────┘
```

- The importer already exposes a **manifest-driven** portal API
  (`/api/manifest`, `/api/config`, `/api/banks/:name`, `/api/validate`).
- The importer supports **bearer-token auth** (`POST /auth/token` →
  `Authorization: Bearer`) for non-browser clients — this app uses it.
- You reach your importer over a **private tunnel** (Tailscale recommended); the
  credential-editing API is never exposed to the public internet.
- Optionally acts as the importer's **OTP channel**: when a bank needs a
  one-time code, the importer prompts *this app* instead of Telegram, and you
  approve the code on your phone. See
  [OTP delivery](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/OTP-AUTOFORWARD.md#alternative-native-app-otp-no-telegram).

## Requirements

- **Node.js 22+** and the [Expo](https://docs.expo.dev/) toolchain (`npx expo`).
- A **running importer** (v1.40.0+) with the config portal enabled, a portal
  password set, and reachable from your phone over a private network.
- For device builds: an **Expo account** (`EXPO_TOKEN`) and, to publish, Apple
  ($99/yr) and/or Google Play ($25) developer accounts.

## Quick start

```bash
npm install
npx expo start        # scan the QR with Expo Go, or press i / a for a simulator
```

Useful scripts:

| Script | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | Strict, type-aware ESLint (`--max-warnings=0`) |
| `npm run lint:fix` | ESLint with autofix |
| `npm run lint:actions` | Verify every GitHub Action is pinned to a commit SHA (`-- --fix` to pin) |
| `npm run lint:lockfile` | Verify every lockfile resolution points at the public npm registry |
| `npm run format` | Format the repo with Prettier |
| `npm run format:check` | Verify Prettier formatting |
| `npm test` | Jest unit tests |
| `npm run export` | Bundle the app for iOS + Android (`expo export`) |
| `npm start` | Expo dev server |

### Code quality

The repo enforces a strict, **type-aware ESLint** config (SonarJS, Unicorn,
JSDoc-on-exports, import sorting, complexity/size caps, no `eslint-disable`/`any`)
with **Prettier** for formatting. **Husky** Git hooks run automatically after
`npm install` (via the `prepare` script):

- **pre-commit** — `lint-staged` runs ESLint (`--max-warnings=0`) + Prettier on staged files.
- **commit-msg** — [commitlint](https://commitlint.js.org/) enforces
  [Conventional Commits](https://www.conventionalcommits.org/).
- **pre-push** — `npm run lint:actions` + `npm run lint:lockfile` +
  `npm run typecheck` + `npm test`.

Reproduce the CI gates locally with `npm run lint`, `npm run format:check`,
`npm run typecheck`, and `npm test`.

Pure logic (OTP codes, config key paths, `showWhen` visibility, per-bank schema
scoping) is additionally covered by [fast-check](https://fast-check.dev/)
property-based tests in `src/**/*.property.test.ts`, which assert invariants over
generated inputs rather than hand-picked examples.

### Working behind a corporate npm mirror

This repo intentionally ships **no `.npmrc`**, so your own `registry=` setting in
`~/.npmrc` keeps working. `package-lock.json` always resolves against the public
`https://registry.npmjs.org/` (enforced by `npm run lint:lockfile`), and CI pins
that same registry in `.github/actions/setup-node`.

Some mirrors lag upstream and will 404 on freshly published versions. When that
happens, install straight from the lockfile's own hosts instead of letting npm
rewrite them to the mirror:

```bash
npm ci --replace-registry-host=never
```

## Install on Android (APK)

Prebuilt Android APKs are attached to each **successful** release on the
[GitHub Releases](https://github.com/sergienko4/israeli-bank-importer-app/releases)
page once `EXPO_TOKEN` is configured — no Play Store needed.

1. Open the latest release and download `israeli-bank-importer.apk` (if no APK
   asset is attached, the build is still in progress or was skipped — check back
   or use the dev build).
2. On your phone, allow installing from your browser or files app
   (Settings → Apps → Special access → Install unknown apps).
3. Open the APK to install, then point the app at your importer's portal.

You only do this once. From then on the app updates itself — see
[Staying up to date](#staying-up-to-date).

> **Security note:** sideloading bypasses Play Store scanning — only install APKs
> from this repository's Releases. The app talks only to the importer you
> configure and keeps tokens in the device keystore (`expo-secure-store`).
>
> **iOS:** Apple does not allow installing an `.ipa` from a web link, so iOS is
> distributed via EAS internal distribution / TestFlight, not GitHub Releases.

## Staying up to date

A sideloaded app gets no store to update it, so the app looks after itself.

- **JavaScript changes** (most releases) ship as an
  [EAS Update](https://docs.expo.dev/versions/v54.0.0/sdk/updates/). The app
  checks on launch, downloads in the background, and then shows a **Restart to
  update** banner. Nothing is swapped out mid-session — the update applies only
  when you tap it, or on the next cold start.
- **Native changes** (a new Expo SDK, a new native module) cannot travel that
  way. `runtimeVersion` uses the `fingerprint` policy, so those releases publish
  under a new runtime id that installed apps ignore. Instead the app checks the
  GitHub Releases API once per launch and shows a **Download** banner linking to
  the new APK.

Both checks are silent when they find nothing, and every failure — offline, rate
limited, malformed response — is treated as "no update" rather than an error the
user cannot act on.

## CI / release

- **CI** (`.github/workflows/ci.yml`): typecheck → lint → format check → tests
  (with coverage) → `expo-doctor` → `expo export`, plus documentation-quality,
  license-compliance, and (secret-gated) SonarCloud, aggregated behind a single
  **CI Pass** gate.
- **Security**: CodeQL (`codeql.yml`), OSSF Scorecard (`scorecard.yml`), gitleaks
  secret scanning (`gitleaks.yml`), and weekly Dependabot updates.
- **Release DAG**: [release-please](https://github.com/googleapis/release-please)
  maintains a version/changelog PR from Conventional Commits; merging it tags a
  release and, in that same run, fans out to three reusable workflows:
  **APK publish** (`release-apk.yml`) builds the Android APK on EAS and attaches
  it to the release, **OTA publish** (`release-ota.yml`) pushes the bundle to
  the EAS `production` channel so installed apps update themselves, and
  **store build** (`release-store.yml`) queues the store-track binary. All three
  are chained rather than triggered by the release event: the tag is created with
  the default `GITHUB_TOKEN`, and GitHub never starts a new workflow run from a
  `GITHUB_TOKEN` event.
- **Versioning**: below `1.0.0` every release is a patch — a `feat:` bumps the
  patch and a breaking change bumps the minor, so the version stays in the `0.x`
  lane until the app is declared stable
  (`bump-patch-for-minor-pre-major` + `bump-minor-pre-major`).
- **Store builds** (`release-store.yml`): queued automatically by the release
  DAG and also runnable on demand from the Actions tab. It builds the Android
  App Bundle only until Apple Developer credentials are on the EAS account —
  set the **`STORE_BUILD_PLATFORM`** repository variable to `all` (or `ios`)
  once they are, and a manual run can pick the platform directly. Submission
  additionally needs an App Store Connect API key (or an Apple ID with a
  distribution certificate and provisioning profile) and a Google Play
  service-account key. The build is queued rather than awaited: the binary is
  collected from EAS, not from GitHub.
- Secret-gated jobs self-skip until `EXPO_TOKEN` / `SONAR_TOKEN` are set, so CI
  stays green without them.

## Roadmap

- ✅ **Phase 1** — connect + log in (bearer token in `expo-secure-store`).
- ✅ **Phase 2** — manifest-driven config editing + banks/targets (mirrors the web portal).
- ✅ **Phase 3** — read-only import status from the importer's audit log.
- ✅ **Phase 4** — native push notifications on import completion (deep-links to status).
- ✅ **Design system** — themed tokens + reusable UI kit (Expo SDK 54).
- ✅ **Per-bank schema fix** — the banks editor scopes to each bank's own fields.
- ✅ **Native motion** — press micro-interactions, direction-aware navigation,
  spring sheets, and skeleton loaders (all reduced-motion aware).
- ✅ **Navigation & home** — persistent bottom tab bar + glanceable home dashboard.
- ✅ **App-based OTP** — approve bank OTP codes in the app instead of Telegram.
- ✅ **Seamless reconnect** — biometric quick unlock + silent re-auth on session expiry.

## Releasing a beta

The release pipeline is already wired (`release-please` → tag → APK attached to
the release). To cut device builds and distribute a beta, one-time setup is
needed:

1. Create an [Expo](https://expo.dev) account and add an **`EXPO_TOKEN`** repository
   secret (Settings → Secrets and variables → Actions) — this unlocks the APK
   publish, the OTA publish, and the store build.
2. Set **`expo.owner`** in `app.json` to your Expo account. CI links the EAS
   project from that plus the slug, so no generated id is checked in. Running
   `eas init` locally is optional and only useful for local `eas build` runs.
3. Add your **Apple Developer** ($99/yr) and/or **Google Play** ($25) accounts to
   EAS for signing + store submission.
4. Merge the open **`release-please`** PR to tag a release; the same run attaches
   the Android APK to the GitHub Release, publishes the over-the-air update, and
   queues the store build. Once Apple credentials are in place, set
   `STORE_BUILD_PLATFORM` to `all` so iOS is queued too and distribute via
   **TestFlight** / EAS internal distribution.

## License

MIT — see [LICENSE](./LICENSE).
