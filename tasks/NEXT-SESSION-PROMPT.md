# Next‑session prompt

Copy the block below into a **new Copilot CLI session started under
`C:\Code\israeli-bank-importer-app`**. It gives the agent full context and the
exact workflow to follow.

---

```text
You are working in C:\Code\israeli-bank-importer-app — an Expo / React Native
(SDK 54) mobile app that edits a self-hosted Israeli Bank Importer's config over
a private network. Node/PowerShell on Windows; use refs/heads/main explicitly.

READ FIRST (in this order), then confirm you understand before coding:
- tasks/README.md, tasks/plan.md, tasks/todo.md, tasks/STATUS.md
- tasks/bug-config-schema.md, tasks/phase-5-ui-design-system.md
- AGENTS.md (Expo has changed — read the versioned docs for the SDK in use, 54)

GOAL: make this app look and move like a professional NATIVE mobile app — real
motion, press micro-interactions, direction-aware + gesture navigation
transitions, spring physics, animated lists, skeleton loaders — NOT a web UI on
a phone. Plus fix the config schema bug where the banks editor shows the global
field catalog instead of each bank's own schema.

USE THE LIFECYCLE SKILLS: run /plan (already drafted in tasks/plan.md — review &
refine it) and /planning-and-task-breakdown to keep tasks small and verifiable,
then /build → /test → /review → /code-simplify → /ship per task.

WORK IN THIS ORDER (from tasks/todo.md):
1. A1 — LAND the uncommitted design system first. It's in the working tree and
   passes typecheck + lint. Run `npx expo-doctor` and `npx expo export`, update
   AGENTS.md to SDK 54, commit on branch `feat/ui-design-system` with Conventional
   Commits (consider splitting tokens/kit · screen migration · SDK bump), open a
   PR, get CI green.
2. B — FIX the config schema bug (correctness) per tasks/bug-config-schema.md:
   write a failing test (B1), decide the per-bank schema source (B2 — OPEN
   DECISION: extend the importer manifest to advertise per-bank allowed/optional
   fields, or scope app-side to `required` only), scope BanksScreen + the "Add
   field" sheet to the bank's schema (B3), regression + live validation (B4).
3. C — PRO MOTION & feel: motion tokens + useReducedMotion (C1), press
   micro-interactions on Button/ListRow/Card (C2), direction-aware + gesture-back
   navigation transitions (C3 — OPEN DECISION: Animated-only vs add
   react-native-reanimated + gesture-handler), list/content motion incl.
   LayoutAnimation, spring Sheet, skeletons, pull-to-refresh (C4), polish +
   reduced-motion a11y audit (C5).

RESOLVE the open questions in tasks/plan.md with me before starting B2 and C3.

RULES: every task needs acceptance criteria + a verification step (typecheck,
lint, expo export, and unit tests where relevant). No PR until it passes local
gates and you've validated the work yourself. Keep tasks/STATUS.md, ROADMAP.md,
and todo.md updated after each merged task. Respect reduced-motion accessibility
in all animations.

Start by reading the tasks/ folder and giving me a short plan for A1 + B, then
wait for my go-ahead.
```

---

## Why these instructions

- **A1 first** protects the large uncommitted design‑system diff (foundation).
- **B before C** fixes correctness (the schema bug) before polishing motion on
  the same `BanksScreen`.
- **Open decisions** (Reanimated vs Animated; importer manifest vs app‑side
  schema; keep screen‑enum router vs react‑navigation) are surfaced so they're
  decided deliberately, not by accident.
- Ties into the lifecycle skills (`/plan`, `/planning-and-task-breakdown`,
  `/build`, `/test`, `/review`, `/code-simplify`, `/ship`).
