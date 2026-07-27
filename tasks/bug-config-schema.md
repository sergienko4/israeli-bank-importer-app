# Bug — Banks editor ignores the per‑bank schema

**Status:** ⬜ open · **Severity:** high (data correctness) · **Area:** `BanksScreen` + manifest
**Filed:** 2026‑07‑27 · **Tracked by:** Phase B in [`plan.md`](./plan.md) / [`todo.md`](./todo.md)

## Summary

When editing a bank, the app shows credential fields from the **global** field
catalog instead of the fields that belong to **that bank's** schema. The
"Add field" sheet lets you add *any* bank's fields to *any* bank (e.g. offering
a card‑number field to a bank that logs in with username + password). The config
is therefore not schema‑aware — it "just shows all config options in the banks."

## Steps to reproduce

1. Connect to an importer, open **Banks**.
2. Add or open a bank (e.g. one that only needs `username` + `password`).
3. Tap **Add field**.
4. **Observed:** the sheet lists credential fields belonging to *other* banks
   (the whole catalog), not just the ones valid for this bank.
5. **Expected:** only fields in this bank's schema (its required + its own
   optional fields) are shown/offered.

## Root cause

In `src/screens/BanksScreen.tsx` the editor uses the **section‑level global
catalog** for every bank:

```ts
const catalog = section.bankFields ?? [];                 // ALL bank fields (global union)
const present = presentFields(catalog, bank);             // fields already on the bank
const missing = catalog.filter((f) => !bank.hasOwnProperty(f.key)); // everything else in the catalog
// … "Add field" sheet renders `missing` → any bank's field can be added
```

The manifest (`src/api/manifest.ts`) only advertises, per bank:

```ts
interface BankRequirement { required: string[]; displayName?: string }
Manifest.bankRequirements: Record<string, BankRequirement>
```

So the importer tells the app which fields are **required** per bank, but **not**
the full **allowed/optional** set per bank. With no per‑bank allow‑list, the
editor falls back to the global `section.bankFields` catalog — the bug.

- `templateBank(required)` (new bank) is correct: it seeds only the bank's
  `required` keys.
- The defect is the **catalog/`missing`** path used for display + "Add field",
  which is not scoped to the selected bank.

## Impact

- Users can attach fields the importer will ignore or reject for that bank.
- The form misrepresents each bank's real schema; higher chance of invalid config
  and confusing `POST /api/validate` errors.

## Fix approach (Phase B)

1. **B1** — failing test: assert a non‑schema field is offered for a given bank.
2. **B2 (open decision #2)** — choose the per‑bank schema source:
   - **Option A (preferred, importer‑side):** extend the manifest so each bank
     advertises its full allowed field set (required + optional), e.g.
     `bankRequirements[bank] = { required, optional, displayName }` or a dedicated
     `bankFields: Record<bank, FieldDef[]>`. The app then scopes to it. *Requires
     an importer change in `israeli-bank-scrapers-to-actual-budget`.*
   - **Option B (interim, app‑side):** with only `required` available, show just
     the required fields and hide/gate the generic "Add field" catalog so no
     cross‑bank fields can be added.
3. **B3** — implement scoping in `BanksScreen` via a `src/config/bankSchema.ts`
   resolver: `allowedFields(manifest, bankId): FieldDef[]`.
4. **B4** — regression tests (unknown bank, no‑optionals bank, `showWhen`
   interplay) + live validation against importer v1.40.0+.

## Acceptance criteria

- [ ] The credential editor and "Add field" sheet only offer fields in the
      selected bank's schema.
- [ ] No field from another bank can be added.
- [ ] Required fields remain non‑removable; the bank's own optionals are removable.
- [ ] Round‑trips through `saveConfig` and passes importer `/api/validate`.
- [ ] Behaviour is data‑driven (no hard‑coded per‑bank field lists in the app).

## Notes / links

- Cross‑repo: Option A needs a manifest change in the backend importer
  (`israeli-bank-scrapers-to-actual-budget`, exposes `/api/manifest`).
- Related files: `src/screens/BanksScreen.tsx`, `src/api/manifest.ts`,
  `src/config/visibility.ts` (the `showWhen` mechanism is the existing precedent
  for schema‑driven field visibility and should be reused/extended).
