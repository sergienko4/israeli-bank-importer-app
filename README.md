# Israeli Bank Importer — Mobile Config App

A cross-platform **Expo / React Native** app (iOS + Android) that lets you edit
your **self-hosted [Israeli Bank Importer](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget)**
configuration from your phone — without SSHing into a server or hand-editing
`config.json`.

The app is a **thin, manifest-driven client**: it talks to *your own* importer's
config portal API over a **private network**, so your bank credentials never
leave your machine and never touch a third-party cloud.

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

## CI / release

- **PR pipeline** (`.github/workflows/ci.yml`): typecheck → lint → `expo-doctor`
  → `expo export` on every pull request.
- **Release DAG**: [release-please](https://github.com/googleapis/release-please)
  maintains a version/changelog PR from Conventional Commits; merging it tags a
  release, which triggers an **EAS build** (`.github/workflows/eas-build.yml`).
  The EAS job self-skips until an `EXPO_TOKEN` repository secret is added, so CI
  stays green without it.

## Roadmap

- ✅ **Phase 1** — connect + log in (bearer token in `expo-secure-store`).
- ✅ **Phase 2** — manifest-driven config editing + banks/targets (mirrors the web portal).
- ✅ **Phase 3** — read-only import status from the importer's audit log.
- ✅ **Phase 4** — native push notifications on import completion (deep-links to status).

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
4. Merge the open **`release-please`** PR to tag a release; the tag triggers an EAS
   build. Distribute via **TestFlight** (iOS) / **Play internal testing** (Android),
   or run `eas build` / `eas submit` directly.

## License

MIT — see [LICENSE](./LICENSE).
