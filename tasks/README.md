# Task Tracking — Israeli Bank Importer (Mobile App)

This folder is the **single source of truth for what is planned, in‑flight, and
done** in the `israeli-bank-importer-app` repo. It exists so progress is
traceable without reading git history or guessing from the working tree.

## Files

| File | Purpose |
| --- | --- |
| [`plan.md`](./plan.md) | **The implementation plan** (`/plan` output): pro‑mobile motion + config schema fix, with dependency graph, vertical slices, checkpoints, risks, and open questions. |
| [`todo.md`](./todo.md) | Ordered checkbox task list for `plan.md`. |
| [`ROADMAP.md`](./ROADMAP.md) | Every phase (1‑6) with a one‑line status. Start here for the big picture. |
| [`STATUS.md`](./STATUS.md) | Live snapshot: current branch, uncommitted work, verification state, next actions. Update this as you work. |
| [`bug-config-schema.md`](./bug-config-schema.md) | 🐞 The banks/config schema bug — root cause, fix approach, acceptance criteria. |
| [`phase-5-ui-design-system.md`](./phase-5-ui-design-system.md) | The design‑system foundation (uncommitted), itemized with the exact files touched. |
| [`phase-6-beta-release.md`](./phase-6-beta-release.md) | The one‑time setup + steps to cut and distribute a beta build. |
| [`NEXT-SESSION-PROMPT.md`](./NEXT-SESSION-PROMPT.md) | Copy‑paste prompt to continue the work in a fresh session under the app path. |

## Conventions

- **Status markers:** ✅ done · 🚧 in progress · ⬜ not started · ⛔ blocked.
- **Phases 1‑4** are shipped and committed (see `ROADMAP.md`); they are kept
  here for the historical record only.
- **Phase 5** is the current work: a themed UI kit + design tokens. It lives in
  the working tree (uncommitted) — track it via `phase-5-ui-design-system.md`.
- Keep `STATUS.md` current: it is the file to read first after any break.
- This folder is **not** git‑ignored — commit it so the tracking survives.

## Quick state (as of 2026‑07‑27)

- Branch: `docs/roadmap-beta` (in sync with origin; no unpushed commits).
- **Goal:** make the app feel like a **pro native mobile app** (motion +
  micro‑interactions), not a web UI. Design‑system foundation is built
  (uncommitted, typecheck+lint green); pro motion is Phase C in `plan.md`.
- 🐞 Open bug: banks editor ignores the per‑bank schema — see `bug-config-schema.md`.
- Next: `plan.md` → A1 (land design system) → B (bug fix) → C (motion). Grab the
  ready‑made prompt in `NEXT-SESSION-PROMPT.md`.
