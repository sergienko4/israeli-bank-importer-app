# Implementation Plan — Pro Mobile UI + Config Schema Fix

> Produced with `/plan` + `planning-and-task-breakdown`. Read‑only planning
> output — no code is changed by this document. Review before `/build`.
> Companion task list: [`todo.md`](./todo.md). Live state: [`STATUS.md`](./STATUS.md).

## Overview

Two workstreams on the `israeli-bank-importer-app` (Expo / React Native):

1. **Pro mobile motion & feel** — the app should look and move like a native
   mobile app, not a web UI ported to a phone. A themed design system + UI kit
   already exists (uncommitted). This workstream lands it, then layers
   **professional motion**: press micro‑interactions, directional + gesture
   navigation transitions, spring physics, animated lists, and skeleton loaders —
   all with reduced‑motion accessibility.
2. **Config schema bug fix** — the banks editor ignores the per‑bank schema and
   exposes the **global** field catalog, so any bank can be given any other
   bank's credential fields. See [`bug-config-schema.md`](./bug-config-schema.md).

## Architecture decisions

- **Motion via the built‑in `Animated` API + native driver** (as `Entrance`
  already does), plus `LayoutAnimation` for list add/remove. Rationale: no heavy
  native deps, works in Expo Go. *Reanimated 3 + Gesture Handler* is the
  alternative if edge‑swipe gestures need to be truly interactive — flagged as an
  open decision (see below).
- **Navigation:** keep the current lightweight screen‑enum router but make it
  **direction‑aware** (forward vs back) and gesture‑friendly, rather than adopting
  `react-navigation` — unless the gesture requirement forces it. Open decision.
- **Design tokens are the single source of truth.** All motion constants
  (durations, easing, spring) live next to `theme/tokens.ts` so timing is
  consistent and tunable in one place.
- **Config schema is manifest‑driven.** The fix must stay data‑driven: the app
  must not hard‑code per‑bank field lists. The correct source is the importer
  manifest — which today only advertises `required` per bank. Resolving that gap
  is the core of the bug fix (open decision: extend importer vs. app‑side scope).

## Dependency graph

```
A1 Land design system (commit + PR)   ← foundation for everything
        │
        ├── B1 Repro test ─ B2 Schema source ─ B3 Scope fields ─ B4 Regress/live
        │        (correctness first — banks editor)
        │
        └── C1 Motion foundation
                 ├── C2 Press micro-interactions
                 ├── C3 Nav transitions (direction + gesture)
                 ├── C4 List/content motion (layout, sheet, skeletons)
                 └── C5 Polish + a11y (reduced-motion, final QA)
```

Order: **A1 → B(1–4) → C(1–5)**. B (correctness) precedes C (polish) because both
touch `BanksScreen`; fixing behavior first avoids animating a broken form.

---

## Phase A — Land the design system (foundation)

### Task A1: Commit + PR the uncommitted design‑system overhaul — **M**

**Description:** The themed tokens, `ThemeContext`, 14‑component UI kit, haptics,
screen migration, and Expo SDK 54 realignment exist in the working tree and pass
typecheck + lint. Land them on a focused branch so later work builds on a clean,
committed base.

**Acceptance criteria:**
- [ ] `npx expo-doctor` and `npx expo export` both pass.
- [ ] `AGENTS.md` updated to reference the SDK actually in use (54, not 57).
- [ ] Committed on `feat/ui-design-system` with Conventional Commits (consider
      splitting tokens/kit · screen migration · SDK bump).

**Verification:** `npm run typecheck` · `npm run lint` · `npx expo export` · PR CI green.
**Dependencies:** None.
**Files:** the Phase‑5 file set (see [`phase-5-ui-design-system.md`](./phase-5-ui-design-system.md)).
**Lifecycle:** `/build` → `/review` → `/ship`.

### Checkpoint A
- [ ] Design system merged to `main`; CI green; app runs in Expo Go (light+dark).

---

## Phase B — Config schema bug fix (correctness)

### Task B1: Reproduce the schema bug with a failing test — **S**
**Description:** Add a test proving the banks editor exposes fields outside the
selected bank's schema (the "Add field" catalog = global `section.bankFields`).
**Acceptance criteria:**
- [ ] A failing unit test shows a non‑schema field is offered for a given bank.
- [ ] Test names the expected (schema‑scoped) vs actual (global) behavior.
**Verification:** `npm test` shows the new test red.
**Dependencies:** A1. **Files:** `src/screens/BanksScreen.*test*`, a small extracted helper.
**Lifecycle:** `/test` (Prove‑It).

### Task B2: Decide + wire the per‑bank schema source — **S/M (has open decision)**
**Description:** The manifest advertises only `required` per bank. Decide whether
to (a) extend the **importer** manifest to advertise the full allowed field set
per bank, or (b) scope app‑side from available data. Implement the chosen source.
**Acceptance criteria:**
- [ ] Decision recorded in `bug-config-schema.md` with rationale.
- [ ] The app can resolve, for a given bank id, the exact allowed field set.
**Verification:** unit test for the resolver over fixtures.
**Dependencies:** B1. **Files:** `src/api/manifest.ts`, new `src/config/bankSchema.ts` (+test); possibly importer repo.
**Lifecycle:** `/spec` (decision) → `/build` → `/test`.

### Task B3: Scope the banks editor to the bank's schema — **M**
**Description:** Use the resolved schema so the credential editor and the
"Add field" sheet only offer fields valid for the selected bank.
**Acceptance criteria:**
- [ ] Shown + addable fields = the bank's schema (required + its own optionals).
- [ ] No cross‑bank fields are offered; B1's test now passes.
- [ ] Required fields remain non‑removable; optionals removable.
**Verification:** `npm test` green; manual check across ≥3 bank types.
**Dependencies:** B2. **Files:** `src/screens/BanksScreen.tsx`, `src/config/*`.
**Lifecycle:** `/build` → `/test` → `/review`.

### Task B4: Regression + live‑importer validation — **S**
**Description:** Guard against regressions and confirm against a real importer.
**Acceptance criteria:**
- [ ] Save round‑trips a scoped bank; importer `/api/validate` accepts it.
- [ ] Tests cover: unknown bank, bank with no optionals, showWhen interplay.
**Verification:** `npm test`; manual E2E vs importer v1.40.0+.
**Dependencies:** B3. **Lifecycle:** `/test` → `/ship`.

### Checkpoint B
- [ ] Banks editor is schema‑correct; regression tests green; validated live.

---

## Phase C — Pro motion & native feel

### Task C1: Motion foundation — **S**
**Description:** Add motion tokens (durations, easing curves, spring configs) and
shared hooks (`usePressScale`, a reduced‑motion flag via `AccessibilityInfo`).
**Acceptance criteria:**
- [ ] `src/theme/motion.ts` exports the constants; `Entrance` consumes them.
- [ ] A `useReducedMotion` hook disables/*shortens* animations when the OS asks.
**Verification:** `npm run typecheck`; unit test for reduced‑motion branch.
**Dependencies:** A1. **Files:** `src/theme/motion.ts`, `src/lib/*`, `Entrance.tsx`.
**Lifecycle:** `/build` → `/test`.

### Task C2: Press micro‑interactions — **M**
**Description:** Buttons, list rows, and cards should depress (scale ~0.97) with a
subtle spring + existing haptic on press.
**Acceptance criteria:**
- [ ] `Button`, `ListRow`, pressable `Card` scale on press‑in and settle on release.
- [ ] Honors reduced‑motion; no jank on low‑end devices.
**Verification:** manual on device; typecheck/lint green.
**Dependencies:** C1. **Files:** `ui/Button.tsx`, `ui/ListRow.tsx`, `ui/Card.tsx`.
**Lifecycle:** `/build` → `/review` → `/code-simplify`.

### Task C3: Directional + gesture navigation transitions — **M/L (open decision)**
**Description:** Make screen changes feel native: forward pushes slide in from the
right, back slides out to the right; add edge‑swipe‑to‑go‑back.
**Acceptance criteria:**
- [ ] Home↔Config/Banks/Status transitions are direction‑aware (not always the same).
- [ ] Edge‑swipe back works on the sub‑screens (or a documented fallback).
**Verification:** manual on iOS + Android.
**Dependencies:** C1. **Files:** `HomeScreen.tsx`, a small `Router`/transition wrapper; possibly add `react-native-reanimated` + `react-native-gesture-handler` (decision).
**Lifecycle:** `/spec` (decision) → `/build` → `/review`.

### Task C4: List & content motion — **M**
**Description:** Animate bank/target/field add‑remove (`LayoutAnimation`), give
`Sheet` spring physics, add pull‑to‑refresh, and replace spinners with skeletons.
**Acceptance criteria:**
- [ ] Adding/removing a bank, target, or field animates layout smoothly.
- [ ] `Sheet` opens/closes with spring; loading states use skeletons not spinners.
**Verification:** manual on device; typecheck/lint green.
**Dependencies:** C1 (C2/C3 ideally first). **Files:** `ui/Sheet.tsx`, `ui/Feedback.tsx` (+`ui/Skeleton.tsx`), `BanksScreen.tsx`, `StatusScreen.tsx`.
**Lifecycle:** `/build` → `/test` → `/code-simplify`.

### Task C5: Polish + accessibility — **S**
**Description:** Final motion pass — animated `StatusPill`/`Banner`, empty‑state
motion — plus a full reduced‑motion audit and QA.
**Acceptance criteria:**
- [ ] With OS "Reduce Motion" on, animations are minimal/instant everywhere.
- [ ] No dropped frames on the main flows on a mid‑range device.
**Verification:** manual a11y pass (VoiceOver/TalkBack + Reduce Motion); typecheck/lint/export green.
**Dependencies:** C2–C4. **Lifecycle:** `/review` → `/ship`.

### Checkpoint C (Complete)
- [ ] App feels native (motion + micro‑interactions), reduced‑motion respected.
- [ ] All acceptance criteria met; ready for a beta cut (Phase 6).

---

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Uncommitted design system lost | High | **A1 first** — land it before any new work. |
| Gesture/interactive transitions need Reanimated + Gesture Handler | Med | Decide in C3; fall back to `Animated`‑only directional transitions if we want to avoid the deps. |
| Importer can't advertise per‑bank optional fields | High | B2 open decision — may require an importer change; interim app‑side scope to `required` + hide generic catalog. |
| Animation jank on low‑end Android | Med | Native driver only; test on a mid‑range device; reduced‑motion path. |
| Expo SDK 54 vs `AGENTS.md`(v57) mismatch | Low | Fix in A1. |

## Open questions (need human input)

1. **C3 transitions:** OK to add `react-native-reanimated` + `react-native-gesture-handler`
   for true edge‑swipe, or keep `Animated`‑only (simpler, less interactive)?
2. **B2 schema source:** extend the **importer** manifest to advertise per‑bank
   allowed/optional fields, or scope app‑side to `required` only for now?
3. **Navigation library:** stay with the screen‑enum router, or adopt
   `react-navigation` (unlocks native transitions + deep‑link routing for push)?
4. Priority: land **A1 + B (bug fix)** first for a correct beta, then C (motion)?
