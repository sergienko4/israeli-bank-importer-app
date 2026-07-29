<!-- Keep the title in Conventional Commit form, e.g. `feat: add reconnect banner`. -->

## What & why
<!-- What does this change do, and why is it needed? Link issues if any. -->

## How
<!-- Key implementation notes, decisions, tradeoffs. -->

## Screenshots / recordings
<!-- For UI changes: before/after on iOS and/or Android. -->

## Verification

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] `npm run export` bundles iOS + Android
- [ ] Manually verified on a device/simulator (describe below)
- [ ] Accessibility: interactive controls have accessible names; touch targets >= 44pt
- [ ] Reduced-motion respected (animations collapse to instant)

## Security and quality

<!-- Delete rows that genuinely do not apply, and say why in "Notes". -->

- [ ] `npm run lint:actions` passes — every `uses:` under `.github/` is pinned to a commit SHA
- [ ] `npm run lint:lockfile` passes — every lockfile resolution is on `https://registry.npmjs.org/`
- [ ] Any new workflow declares top-level `permissions: contents: read`, and any
      broader scope is requested at job level with a comment explaining why
- [ ] No new dependency added without checking it is maintained and its advisories are clean
- [ ] No secrets, tokens, bank credentials, or OTP codes added to code, logs, or fixtures
- [ ] New pure logic has tests; invariant-shaped logic has a `*.property.test.ts`

## Notes for reviewers
<!-- Anything reviewers should focus on, or follow-ups deferred. -->
