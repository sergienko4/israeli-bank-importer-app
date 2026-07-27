# Roadmap — Israeli Bank Importer (Mobile App)

A cross‑platform Expo / React Native app that edits a self‑hosted
[Israeli Bank Importer](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget)
configuration from your phone over a private network. The app is a thin,
manifest‑driven client of the importer's portal API — bank credentials never
leave your machine.

Legend: ✅ done · 🚧 in progress · ⬜ not started · ⛔ blocked

---

## Phase 1 — Connect + log in ✅

Bearer‑token auth against the importer portal, token stored in
`expo-secure-store`.

- Reach the importer over a private tunnel (Tailscale/VPN).
- `POST /auth/token` → `Authorization: Bearer …` for all later calls.
- **Screens:** `ConnectScreen`.
- **Commit:** `fa42656 feat: connect + log in to a self-hosted importer`.

## Phase 2 — Manifest‑driven config editing ✅

Mirrors the web portal: reads `/api/manifest` and renders the config form
dynamically; edits banks + import targets.

- `GET /api/manifest`, `GET/PUT /api/config`, `GET/PUT /api/banks/:name`,
  `POST /api/validate`.
- **Screens:** `ConfigScreen`, `BanksScreen`; shared `SectionForm`, `FieldInput`.
- **Commits:** `2279f37 feat: manifest-driven config editing`,
  `bc3ca67 feat: banks + targets editor`.

## Phase 3 — Import status (read‑only) ✅

Shows the importer's audit log / last import outcome.

- **Screen:** `StatusScreen`.
- **Commit:** `55c0a7b feat: import status screen`.

## Phase 4 — Push notifications ✅

Native push on import completion; notification deep‑links into the status screen.

- Device registration + Expo push token; deep‑link handling in `App.tsx`.
- **Commit:** `22ff07f feat: push notifications (register + deep-link)`.

## Phase 5 — UI / design‑system foundation 🚧  ← current work

A themed UI kit and design tokens replacing ad‑hoc inline styles across every
screen. Also realigns the Expo SDK to the stable 54 line and adds haptics +
safe‑area support. This is the **foundation** for the pro‑mobile look.

- Design tokens (light + dark emerald palette, spacing/radius/typography).
- `ThemeContext` + `useTheme`; 14‑component UI primitive kit.
- All 5 screens + shared form components reworked onto the kit.
- **State:** uncommitted in the working tree; `typecheck` ✅ and `lint` ✅ pass.
- **Tracking:** [`phase-5-ui-design-system.md`](./phase-5-ui-design-system.md).

## Phase B — Config schema bug fix ⬜  ← correctness, do before polish

The banks editor exposes the **global** field catalog instead of each bank's own
schema. Data‑correctness bug; must be fixed before a beta.

- **Tracking:** [`bug-config-schema.md`](./bug-config-schema.md), Phase B in
  [`plan.md`](./plan.md).

## Phase C — Pro motion & native feel ⬜  ← "like a pro app, not a web UI"

Layer professional motion on the design system: press micro‑interactions,
direction‑aware + gesture navigation transitions, spring physics, animated
lists, and skeleton loaders — with reduced‑motion accessibility.

- **Tracking:** Phase C in [`plan.md`](./plan.md) / [`todo.md`](./todo.md).

## Phase 6 — Beta release ⬜

Cut and distribute a device build via EAS → TestFlight / Play internal testing.
Pipeline (`release-please` → tag → `eas-build.yml`) is already wired; blocked
only on one‑time account setup.

- **Tracking:** [`phase-6-beta-release.md`](./phase-6-beta-release.md).

---

## Related repo

The backend importer (`israeli-bank-scrapers-to-actual-budget`) is a **separate
project** at release 1.39.2+. It exposes the portal API this app consumes
(`/api/manifest`, `/api/config`, bearer‑token auth, `/api/status`) and the push
notifier. This app requires importer **v1.40.0+** with the config portal enabled.
