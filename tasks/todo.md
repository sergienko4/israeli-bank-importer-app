# Todo — Pro Mobile UI + Config Schema Fix

> Ordered, checkbox task list for [`plan.md`](./plan.md). Check items off as they
> land. `[ ]` todo · `[~]` in progress · `[x]` done. Keep in sync with `STATUS.md`.

## Phase A — Land the design system (foundation)

- [ ] **A1** Commit + PR the uncommitted design‑system overhaul (M)
  - [ ] `npx expo-doctor` passes
  - [ ] `npx expo export` passes
  - [ ] `AGENTS.md` updated to Expo SDK 54
  - [ ] Committed on `feat/ui-design-system` (Conventional Commits; consider split)
  - [ ] PR opened, CI green, merged

**Checkpoint A:** design system on `main`, CI green, runs light+dark.

## Phase B — Config schema bug fix (correctness) — see `bug-config-schema.md`

- [ ] **B1** Failing test reproducing the global‑catalog bug (S)
- [ ] **B2** Decide + wire per‑bank schema source *(open decision #2)* (S/M)
  - [ ] Decision recorded in `bug-config-schema.md`
  - [ ] `src/config/bankSchema.ts` resolver + test
- [ ] **B3** Scope banks editor + "Add field" to the bank's schema (M)
  - [ ] No cross‑bank fields offered; B1 test now green
  - [ ] Required non‑removable; optionals removable
- [ ] **B4** Regression tests + live‑importer validation (S)

**Checkpoint B:** banks editor schema‑correct; regression green; validated live.

## Phase C — Pro motion & native feel

- [ ] **C1** Motion foundation: `theme/motion.ts` tokens + `useReducedMotion` (S)
- [ ] **C2** Press micro‑interactions on Button / ListRow / Card (M)
- [ ] **C3** Directional + gesture nav transitions *(open decision #1/#3)* (M/L)
- [ ] **C4** List/content motion: LayoutAnimation, spring Sheet, skeletons, pull‑to‑refresh (M)
- [ ] **C5** Polish + accessibility (reduced‑motion audit, QA) (S)

**Checkpoint C (Complete):** native feel; reduced‑motion respected; ready for beta.

## Cross‑cutting

- [ ] Keep `STATUS.md` + `ROADMAP.md` current after each merged task.
- [ ] Resolve open questions in `plan.md` before starting C3 and B2.

## Suggested first session

`A1` (land current work) → `B1`+`B2` (bug decision + resolver). See
[`NEXT-SESSION-PROMPT.md`](./NEXT-SESSION-PROMPT.md).
