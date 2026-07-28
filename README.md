# Israeli Bank Importer — Mobile Config App

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

> **Status:** early scaffold. The connection/login and config-editing screens are
> built out in phases — see the [plan](#roadmap).

## How it works

```text
 ┌────────────┐   Authorization: Bearer <token>   ┌───────────────────────────┐
 │  This app  │ ────────  private network  ─────► │  Your self-hosted importer │
 │ (phone)    │        (Tailscale / VPN)          │  portal API  /api/*        │
 └────────────┘ ◄──────  manifest + config  ───── └───────────────────────────┘
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

- **Node.js 20+** and the [Expo](https://docs.expo.dev/) toolchain (`npx expo`).
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
| `npm run lint` | ESLint (Expo config) |
| `npm run export` | Bundle the app for iOS + Android (`expo export`) |
| `npm start` | Expo dev server |

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

> **Security note:** sideloading bypasses Play Store scanning — only install APKs
> from this repository's Releases. The app talks only to the importer you
> configure and keeps tokens in the device keystore (`expo-secure-store`).
>
> **iOS:** Apple does not allow installing an `.ipa` from a web link, so iOS is
> distributed via EAS internal distribution / TestFlight, not GitHub Releases.

## CI / release

- **CI** (`.github/workflows/ci.yml`): typecheck → lint → tests (with coverage) →
  `expo-doctor` → `expo export`, plus documentation-quality, license-compliance,
  and (secret-gated) SonarCloud, aggregated behind a single **CI Pass** gate.
- **Security**: CodeQL (`codeql.yml`), OSSF Scorecard (`scorecard.yml`), gitleaks
  secret scanning (`gitleaks.yml`), and weekly Dependabot updates.
- **Release DAG**: [release-please](https://github.com/googleapis/release-please)
  maintains a version/changelog PR from Conventional Commits; merging it tags a
  release, which triggers the **EAS build** (`eas-build.yml`) and the **APK
  publish** (`release-apk.yml`) that attaches the Android APK to the release.
  Secret-gated jobs self-skip until `EXPO_TOKEN` / `SONAR_TOKEN` are set, so CI
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

The release pipeline is already wired (`release-please` → tag → EAS build). To cut
device builds and distribute a beta, one-time setup is needed:

1. Create an [Expo](https://expo.dev) account and add an **`EXPO_TOKEN`** repository
   secret (Settings → Secrets and variables → Actions) — this unlocks
   `eas-build.yml`.
2. Run **`eas init`** once locally to link the project (writes `extra.eas.projectId`
   into `app.json`); this id is also what the app uses to mint push tokens.
3. Add your **Apple Developer** ($99/yr) and/or **Google Play** ($25) accounts to
   EAS for signing + store submission.
4. Merge the open **`release-please`** PR to tag a release; the tag triggers the EAS
   build and the **APK publish** (`release-apk.yml`) attaches the Android APK to
   the GitHub Release. Distribute Android via the release APK, and iOS via
   **TestFlight** / EAS internal distribution, or run `eas build` / `eas submit`
   directly.

## License

MIT — see [LICENSE](./LICENSE).
