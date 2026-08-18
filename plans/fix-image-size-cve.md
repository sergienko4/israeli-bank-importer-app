# Patch image-size CVE-2025-71329 / CVE-2025-71330 (infinite-loop DoS)

Close the three open GitHub alerts (Dependabot #20, #21, CodeQL #33, score 8) by
patching the vulnerable parsers in the transitive dependency `image-size@1.2.1`
and dismissing the alerts with a documented, evidence-based reason — no fixed
release exists upstream (advisory `remediation: null`, latest 2.0.2 still in the
affected range, project dormant since Apr 2025).

## For Future Agents

As work proceeds: mark checkboxes `- [x]` as items complete; when a phase is done,
set its status to `Complete` and write its **Phase Summary**; run the phase's
**Verification Plan** and record the result before moving on. When all phases are
done, fill in **Final Recap** and **Deployment Plan**.

## Phase 1: Patch the vulnerable parsers

Status: Complete

- [x] Create branch from `origin/main`
- [x] Add `patch-package` as devDependency + `postinstall` script in `package.json`
- [x] Fix `node_modules/image-size/dist/types/icns.js`: guard zero-length entry (advance or break instead of `imageOffset += 0`)
- [x] Fix `node_modules/image-size/dist/types/jxl.js` `extractPartialStreams`: break on zero-size `jxlp` box
- [x] Generate `patches/image-size+1.2.1.patch` via `npx patch-package image-size`

### Verification Plan

- `npx patch-package` applies cleanly (exit 0) — done
- Patch file exists at `patches/image-size+1.2.1.patch` and contains both parser guards — done
- `npm install` (fresh) leaves node_modules/image-size patched — verified via patch-package dry install

### Phase Summary

- Branch `fix/security/image-size-cve` created from `origin/main` (PR #97 + dependabot #95/#96 merged).
- `patch-package@^8.0.1` added to devDependencies; `"postinstall": "patch-package"` added to scripts.
- `icns.js`: `if (imageHeader[1] === 0) break;` before the offset advance.
- `jxl.js`: `if (jxlpBox.size === 0) break;` before the offset advance.
- Patch generated and committed-ready at `patches/image-size+1.2.1.patch`.

## Phase 2: Verify the fix

Status: Complete

- [x] Crafted-buffer no-hang proof: ICNS buffer with zero-length entry + JXL container with zero-size `jxlp` box must return (not hang) under a 5s timeout, before and after patch
- [x] Valid images still parse: ICNS/JXL/HEIF regression checks on valid fixtures
- [x] `npm test` green
- [x] Bundle/export still works (exercises metro's use of image-size)

### Verification Plan

- `timeout 5 node script` exits 0 (no hang) on crafted buffers; exits 1 (hang detected) on unpatched code — done (15s watchdog: unpatched 1.2.1 HANG DETECTED on both ICNS and JXL crafted buffers; patched returns in 2ms/7ms)
- `npm test` passes — 615 passed / 4 skipped / 61 suites, 22.7s
- `npx expo export` (or equivalent) succeeds — dist exported (android + ios bundles)

### Phase Summary

- Repro harness: crafted ICNS (zero-length entry) and JXL (zero-size `jxlp` box) buffers, run through image-size with a 15s watchdog.
- Unpatched clean image-size@1.2.1: both crafted buffers HANG (killed after 15s).
- Patched copy: ICNS-crafted returns 2ms with first image; JXL-crafted throws "Reached end of input" in 7ms; valid minimal ICNS still parses (32x32).
- Full suite green; `npm run export` builds both platform bundles (metro uses image-size for asset sizing).

## Phase 3: Dismiss alerts with documented reason

Status: Complete

- [x] Dismiss Dependabot #20 and #21 (`tolerable_risk`) with comment referencing GHSA, patch file, verification results
- [x] Dismiss CodeQL #33 (`won't fix` + mitigation comment) with same evidence
- [x] Confirm all three alerts closed via API

### Phase Summary

- Dependabot #20/#21 dismissed 2026-08-18T17:53:15/16Z, reason `tolerable_risk`, comment documents patch file, repro evidence, and upstream status.
- CodeQL #33 dismissed 2026-08-18T17:53:29Z. `mitigated` reason is not enabled for the repo; used `won't fix` (no fixed release exists so the lockfile cannot be fixed) with the mitigation evidence in the comment.
- Full comment (≤280 chars): "Locally patched (patches/image-size+1.2.1.patch): ICNS/JXL zero-size guards; repro hangs unpatched, <10ms after; 615 tests + export green. No fixed upstream release (2026-08-07; 2.0.2 affected). Build-time-only, no attacker input. Re-evaluate on upstream fix."

### Verification Plan

- `gh api .../dependabot/alerts/{20,21}` → `state: dismissed` with comment
- `gh api .../code-scanning/alerts/33` → `state: dismissed` with comment

## Phase 4: Commit, push, PR

Status: Complete

- [x] Pre-flight checklist per `before-commit-guidlines.md` (50/72 subject/body, atomic, selective staging)
- [x] Commit: patch-package infra + parser guards + plan file
- [x] Push, open PR with `## Guideline compliance` table + evidence
- [x] Read `post-pr-checklist.md` after PR opens

### Verification Plan

- `npm run lint`, `lint:md`, `format:check`, `typecheck`, `npm test` all green (pre-push hook runs them) — done
- PR body includes compliance table; PR URL reported — done: <https://github.com/sergienko4/israeli-bank-importer-app/pull/99>

### Phase Summary

- Pre-flight: subject 41 chars (≤50), body wrap ≤72 verified with awk, staging selective (4 files).
- Commit `5b47986` — `fix(security): patch image-size DoS loops`.
- Fresh `npm ci` verified postinstall applies the patch (guards present; crafted buffers return in ≤2ms).
- Pre-push battery green; PR #99 opened with compliance table (7 rows, evidence per row).
- `post-pr-checklist.md` read: scoped to `israeli-bank-scrapers-fork` (OODA/KG/SQL infra); only CR rate-limit watchdog applies here — CodeRabbit queued, no rate-limit comment → hands off.
- CI on PR: Documentation Quality pass, Gitleaks pass; Typecheck/lint/bundle + CodeQL + License pending.

## Final Recap

- All 3 GitHub alerts (Dependabot #20/#21, CodeQL #33) closed with documented evidence; root cause was the transitive `image-size@1.2.1` ICNS/JXL infinite-loop CVEs with no fixed release upstream.
- Fix shipped as patch-package guards + postinstall (PR #99, commits `5b47986`, `69db686`, `21f1859`): fresh installs and CI re-apply the patch deterministically; repro proved hang-on-unpatched / ≤2ms-after-patch; 615 tests + export green.
- CodeRabbit cycle 1 (triggered after 15-min rate-limit cooldown): 1 finding — Major, `postinstall` must fail closed (`patch-package --error-on-fail`). Resolved in `21f1859`; disposition recorded in PR body table. No reply threads (C10).

## Deployment Plan

- Merge PR #99; CI (`npm ci` → postinstall) keeps every install patched. No rollout steps — build-time dependency only.
- When upstream publishes a patched image-size release (advisory currently has none): Dependabot will bump `image-size` (needs a metro/expo release allowing it), then remove `patches/image-size+1.2.1.patch` and the `postinstall` script in a follow-up, and un-dismiss/re-open tracking of the alerts.
- Dismissal comments (all three alerts) carry the full evidence chain for auditability.

- Merge PR; CI (npm ci → postinstall → patch applied) keeps the fix on every install
- When upstream publishes a patched image-size release: Dependabot bumps, then remove `patches/image-size+1.2.1.patch` and the `postinstall` script in a follow-up
