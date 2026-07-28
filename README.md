# Israeli Bank Importer â€” Mobile Config App

A cross-platform **Expo / React Native** app (iOS + Android) that lets you edit
your **self-hosted [Israeli Bank Importer](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget)**
configuration from your phone â€” without SSHing into a server or hand-editing
`config.json`.

The app is a **thin, manifest-driven client**: it talks to *your own* importer's
config portal API over a **private network**, so your bank credentials never
leave your machine and never touch a third-party cloud.

> **Companion backend:** this app configures the self-hosted
> [**israeli-bank-scrapers-to-actual-budget**](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget)
> importer â€” the server that scrapes your banks and imports into
> [Actual Budget](https://actualbudget.org/). You need that importer running
> (with its config portal enabled) to use this app.

## How it works

```text
 â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”   Authorization: Bearer <token>   â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
 â”‚  This app  â”‚ â”€â”€â”€â”€â”€â”€â”€â”€  private network  â”€â”€â”€â”€â”€â–º â”‚  Your self-hosted importer â”‚
 â”‚ (phone)    â”‚        (Tailscale / VPN)          â”‚  portal API  /api/*        â”‚
 â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â—„â”€â”€â”€â”€â”€â”€  manifest + config  â”€â”€â”€â”€â”€ â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

- The importer already exposes a **manifest-driven** portal API
  (`/api/manifest`, `/api/config`, `/api/banks/:name`, `/api/validate`).
- The importer supports **bearer-token auth** (`POST /auth/token` â†’
  `Authorization: Bearer`) for non-browser clients â€” this app uses it.
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
page once `EXPO_TOKEN` is configured â€” no Play Store needed.

1. Open the latest release and download `israeli-bank-importer.apk` (if no APK
   asset is attached, the build is still in progress or was skipped â€” check back
   or use the dev build).
2. On your phone, allow installing from your browser or files app
   (Settings â†’ Apps â†’ Special access â†’ Install unknown apps).
3. Open the APK to install, then point the app at your importer's portal.

> **Security note:** sideloading bypasses Play Store scanning â€” only install APKs
> from this repository's Releases. The app talks only to the importer you
> configure and keeps tokens in the device keystore (`expo-secure-store`).
>
> **iOS:** Apple does not allow installing an `.ipa` from a web link, so iOS is
> distributed via EAS internal distribution / TestFlight, not GitHub Releases.

## CI / release

- **CI** (`.github/workflows/ci.yml`): typecheck â†’ lint â†’ tests (with coverage) â†’
  `expo-doctor` â†’ `expo export`, plus documentation-quality, license-compliance,
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

- âœ… **Phase 1** â€” connect + log in (bearer token in `expo-secure-store`).
- âœ… **Phase 2** â€” manifest-driven config editing + banks/targets (mirrors the web portal).
- âœ… **Phase 3** â€” read-only import status from the importer's audit log.
- âœ… **Phase 4** â€” native push notifications on import completion (deep-links to status).
- âœ… **Design system** â€” themed tokens + reusable UI kit (Expo SDK 54).
- âœ… **Per-bank schema fix** â€” the banks editor scopes to each bank's own fields.
- âœ… **Native motion** â€” press micro-interactions, direction-aware navigation,
  spring sheets, and skeleton loaders (all reduced-motion aware).
- âœ… **Navigation & home** â€” persistent bottom tab bar + glanceable home dashboard.
- âœ… **App-based OTP** â€” approve bank OTP codes in the app instead of Telegram.
- âœ… **Seamless reconnect** â€” biometric quick unlock + silent re-auth on session expiry.

## Releasing a beta

The release pipeline is already wired (`release-please` â†’ tag â†’ EAS build). To cut
device builds and distribute a beta, one-time setup is needed:

1. Create an [Expo](https://expo.dev) account and add an **`EXPO_TOKEN`** repository
   secret (Settings â†’ Secrets and variables â†’ Actions) â€” this unlocks
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

MIT â€” see [LICENSE](./LICENSE).
