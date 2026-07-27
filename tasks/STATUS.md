# Status — live snapshot

> Read this first after any break. Keep it current.
> Last updated: **2026‑07‑27**.

## Current position

- **Repo:** `israeli-bank-importer-app` (Expo / React Native).
- **Branch:** `docs/roadmap-beta` — in sync with `origin` (no unpushed commits).
- **HEAD:** `356229c docs: mark roadmap complete + beta-release guide`.
- **Roadmap:** Phases 1‑4 ✅ shipped. Phase 5 (UI kit) 🚧 in the working tree.
  Phase 6 (beta) ⬜ not started.

## In‑flight work — Phase 5 (UI / design system) 🚧

A themed UI kit + design tokens overhaul, **uncommitted** in the working tree.

- **Verification:** `npm run typecheck` ✅ clean · `npm run lint` ✅ clean.
- **Not yet run / verify before commit:** `npx expo export`, `npx expo-doctor`.
- **New files (untracked):**
  - `src/theme/tokens.ts`, `src/theme/ThemeContext.tsx`
  - `src/components/ui/` — 14 files: `AppHeader`, `Banner`, `Button`, `Card`,
    `Divider`, `EmptyState`, `Entrance`, `Feedback` (ErrorView + Loader),
    `ListRow`, `Screen`, `Sheet`, `StatusPill`, `TextField`, `index.ts` barrel.
  - `src/lib/haptics.ts`
- **Modified files:**
  - `App.tsx` (Theme provider wiring), `app.json`
  - `src/components/FieldInput.tsx`, `src/components/SectionForm.tsx`
  - `src/screens/{Home,Connect,Config,Banks,Status}Screen.tsx`
  - `package.json`, `package-lock.json` (Expo SDK 57 → **54**; add
    `expo-haptics`, `react-native-safe-area-context`).
- **Detail + checklist:** [`phase-5-ui-design-system.md`](./phase-5-ui-design-system.md).

## Recommended next step

Follow the plan in [`plan.md`](./plan.md) / [`todo.md`](./todo.md), in order:

1. **A1 — land the design system.** Run `expo-doctor` + `expo export` (not yet
   run), update `AGENTS.md` to SDK 54, commit on `feat/ui-design-system`, PR, merge.
2. **B — fix the config schema bug** (correctness) — see
   [`bug-config-schema.md`](./bug-config-schema.md).
3. **C — pro motion & native feel** (press interactions, nav transitions, gesture
   back, spring physics, animated lists, skeletons).

A copy‑paste continuation prompt for a fresh session lives in
[`NEXT-SESSION-PROMPT.md`](./NEXT-SESSION-PROMPT.md).

## Known issues

- 🐞 **Banks editor ignores the per‑bank schema** — shows the global field
  catalog; any bank's fields can be added to any bank. High severity (data
  correctness). Full detail + fix plan: [`bug-config-schema.md`](./bug-config-schema.md).

## Notes / watch‑outs

- **Expo SDK downgrade 57 → 54 is intentional** — 54 is the stable line the UI
  kit targets; `node_modules` already resolves `expo@54.0.36`. `AGENTS.md` still
  points at the v57 docs URL — update it to the SDK actually in use before
  committing, to avoid a docs/code mismatch.
- `package-lock.json` has a very large diff from the SDK realignment — expected.
- This `tasks/` folder is **not** git‑ignored; commit it so tracking persists.

## Other threads (context)

- The backend importer decoupling sweep (separate repo,
  `israeli-bank-scrapers-to-actual-budget`) is **complete**: PRs #425–#428 all
  merged (Jun 11). PR #428 (BankScraper split) dropped the critical‑coupling
  bucket 9 → 7. That repo has since advanced to release 1.39.2. No open action
  here; the stale PR‑monitor schedule was stopped.
