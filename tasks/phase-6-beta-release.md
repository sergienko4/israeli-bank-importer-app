# Phase 6 — Beta Release ⬜

**Goal:** cut and distribute a device build (iOS TestFlight / Android Play
internal testing). The pipeline is already wired — this phase is one‑time account
setup plus flipping the release switch.

Legend: ✅ done · ⬜ not started · ⛔ blocked

## Already wired ✅

- ✅ **PR pipeline** (`.github/workflows/ci.yml`): typecheck → lint →
  `expo-doctor` → `expo export` on every PR.
- ✅ **Release DAG**: `release-please` maintains a version/changelog PR from
  Conventional Commits; merging it tags a release.
- ✅ **EAS build** (`.github/workflows/eas-build.yml`): triggered by the release
  tag. It **self‑skips** until `EXPO_TOKEN` is set, so CI stays green without it.

## One‑time setup ⬜

- ⬜ Create an [Expo](https://expo.dev) account.
- ⬜ Add an **`EXPO_TOKEN`** repository secret (Settings → Secrets and variables
  → Actions) — unlocks `eas-build.yml`.
- ⬜ Run **`eas init`** once locally to link the project (writes
  `extra.eas.projectId` into `app.json`). This id is also what the app uses to
  mint push tokens (Phase 4).
- ⬜ Add **Apple Developer** ($99/yr) and/or **Google Play** ($25) accounts to
  EAS for signing + store submission.

## Cut the beta ⬜

- ⬜ Ensure Phase 5 is merged and `main` is green.
- ⬜ Merge the open **`release-please`** PR → tags a release → triggers EAS build.
- ⬜ Distribute: **TestFlight** (iOS) / **Play internal testing** (Android), or
  run `eas build` / `eas submit` directly.
- ⬜ Verify the pushed build against a real importer (v1.40.0+) over the private
  tunnel: connect/login, edit config, view status, receive a push.

## Blockers

- ⛔ Store distribution requires paid developer accounts (Apple/Google) — out of
  scope until the owner provisions them.

## Definition of done

- [ ] `EXPO_TOKEN` set; `eas-build.yml` no longer self‑skips.
- [ ] A tagged release produces a downloadable EAS build.
- [ ] Beta installed on at least one physical device and smoke‑tested end‑to‑end
      against a live importer.
