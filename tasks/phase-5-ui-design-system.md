# Phase 5 — UI / Design‑System Overhaul 🚧

**North‑star:** make the app look and move like a **professional native mobile
app**, not a web UI on a phone. This phase is the design‑system *foundation*
(tokens + themed primitive kit); the **pro motion & feel** work (press
micro‑interactions, native navigation transitions, gesture back, spring physics,
animated lists, skeletons) is planned as **Phase C in [`plan.md`](./plan.md)**.

**Goal (this phase):** replace ad‑hoc inline styles across every screen with a
single themed design system (tokens + a reusable primitive kit), add light/dark
theming, haptics, and safe‑area handling, and realign the Expo SDK to the stable
54 line.

**State:** implemented in the working tree, **uncommitted**. `typecheck` ✅ and
`lint` ✅ pass. Not yet committed, exported, or PR'd. Landing this is **Task A1**
in `plan.md` — do it first.

> **Related bug:** the banks config editor ignores the per‑bank schema — see
> [`bug-config-schema.md`](./bug-config-schema.md) (Phase B). Fix correctness
> before polishing motion on that screen.

Legend: ✅ done · 🚧 in progress · ⬜ not started

---

## 1. Design tokens ✅

`src/theme/tokens.ts` — single source of truth.

- ✅ `ThemeColors` semantic roles (bg, surface, border, text, primary, success,
  danger, warning, overlay, …).
- ✅ `lightColors` + `darkColors` (emerald / fintech‑green brand).
- ✅ `spacing` (4px scale), `radius`, `typography` scales.

## 2. Theme context ✅

`src/theme/ThemeContext.tsx`.

- ✅ `ThemeProvider` + `useTheme` hook exposing colors + scale + active scheme.
- ✅ `App.tsx` wraps the tree: `SafeAreaProvider → ThemeProvider → AuthProvider`.
- ✅ `StatusBar` style follows the active theme scheme.

## 3. UI primitive kit ✅

`src/components/ui/` (barrel: `index.ts`).

- ✅ Layout: `Screen`, `AppHeader`, `Card`, `Divider`, `Sheet`, `Entrance`.
- ✅ Input: `Button` (variants + sizes), `TextField`.
- ✅ Data/feedback: `ListRow`, `StatusPill` (tones), `Banner` (tones),
  `EmptyState`, `Feedback` (`Loader` + `ErrorView`).
- ✅ `src/lib/haptics.ts` — haptic feedback helper (uses `expo-haptics`).

## 4. Screen migration ✅

Every screen + shared form component moved onto the kit.

- ✅ `HomeScreen`, `ConnectScreen`, `ConfigScreen`, `BanksScreen`, `StatusScreen`.
- ✅ Shared: `src/components/FieldInput.tsx`, `src/components/SectionForm.tsx`.

## 5. Dependency / SDK realignment ✅

`package.json` + `package-lock.json`.

- ✅ Expo SDK **57 → 54** (`expo@54.0.36` resolved in `node_modules`).
- ✅ Added `expo-haptics`, `react-native-safe-area-context`.
- ✅ Aligned `react`, `react-native`, `@types/react`, `eslint-config-expo`,
  `jest-expo`, `react-test-renderer` to the SDK 54 line.

## 6. Verification & landing ⬜  ← remaining work

- ✅ `npm run typecheck` passes.
- ✅ `npm run lint` passes.
- ⬜ `npx expo-doctor` — run before commit.
- ⬜ `npx expo export` — confirm the bundle builds (this is a CI gate).
- ⬜ Manual smoke on device / Expo Go: light + dark, each screen, haptics.
- ⬜ Update `AGENTS.md` — it still points at the **v57** docs URL; change it to
  the SDK actually in use (54) to avoid a docs/code mismatch.
- ⬜ Commit on a focused branch `feat/ui-design-system` (Conventional Commits).
      Consider splitting: (a) tokens + theme + UI kit, (b) screen migration,
      (c) SDK/deps bump — the screens diff alone is ~1000 lines.
- ⬜ Open PR; let CI run (`typecheck → lint → expo-doctor → expo export`).
- ⬜ On merge: set `ROADMAP.md` Phase 5 → ✅ and refresh `STATUS.md`.

---

## Acceptance criteria

- [ ] App builds (`expo export`) and runs in Expo Go on iOS + Android.
- [ ] Light and dark themes both render correctly on all 5 screens.
- [ ] No raw pixel values / hard‑coded colors left in migrated screens — all read
      from tokens via `useTheme`.
- [ ] `typecheck`, `lint`, `expo-doctor`, `expo export` all green.
- [ ] `AGENTS.md` references the SDK version actually in use.
- [ ] Conventional‑Commit history; PR merged; roadmap + status updated.

## Files in this phase

**New (untracked)**

```
src/theme/tokens.ts
src/theme/ThemeContext.tsx
src/lib/haptics.ts
src/components/ui/AppHeader.tsx
src/components/ui/Banner.tsx
src/components/ui/Button.tsx
src/components/ui/Card.tsx
src/components/ui/Divider.tsx
src/components/ui/EmptyState.tsx
src/components/ui/Entrance.tsx
src/components/ui/Feedback.tsx
src/components/ui/ListRow.tsx
src/components/ui/Screen.tsx
src/components/ui/Sheet.tsx
src/components/ui/StatusPill.tsx
src/components/ui/TextField.tsx
src/components/ui/index.ts
```

**Modified**

```
App.tsx
app.json
package.json
package-lock.json
src/components/FieldInput.tsx
src/components/SectionForm.tsx
src/screens/BanksScreen.tsx
src/screens/ConfigScreen.tsx
src/screens/ConnectScreen.tsx
src/screens/HomeScreen.tsx
src/screens/StatusScreen.tsx
```
