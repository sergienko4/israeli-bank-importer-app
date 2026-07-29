# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, report privately via GitHub's
[private vulnerability reporting](https://github.com/sergienko4/israeli-bank-importer-app/security/advisories/new)
(Security → Advisories → Report a vulnerability).

Include:

- A description of the issue and its impact.
- Steps to reproduce or a proof of concept.
- Affected version(s) and platform (iOS / Android).

**Never include real bank credentials, portal tokens, or account numbers** in a
report — redact them.

## Scope

This app is a **thin client** that edits a self-hosted importer's config over a
private network. It stores the importer's bearer token and (optionally) the
portal password in the OS keystore via `expo-secure-store`, and talks only to
the importer you point it at. Relevant concerns include:

- Handling of the portal bearer token and stored password (at rest and in
  transit).
- OTP code handling in the app-based OTP flow.
- Any leakage of credentials/tokens to logs, crash reports, or third parties.

## Supported versions

The latest released version is supported. Older versions are not patched.

## Supply-chain hardening

The build pipeline follows the [OpenSSF Scorecard](https://scorecard.dev/)
checks. The rules below are enforced automatically, not by convention:

- **Actions are pinned to commit SHAs.** Every `uses:` under `.github/` — in
  workflows *and* in composite actions — must reference a 40-character commit
  SHA with the human-readable tag in a trailing comment. `npm run lint:actions`
  fails the build otherwise; `npm run lint:actions -- --fix` resolves tags to
  SHAs for you. A mutable tag like `@v4` lets an upstream account takeover run
  arbitrary code in CI.
- **Workflow tokens are least-privilege.** Each workflow declares
  `permissions: contents: read` at the top level, and any job needing more (for
  example `contents: write` to upload a release asset) requests it at the job
  level with a comment explaining why.
- **The lockfile resolves only to the public registry.** `npm run lint:lockfile`
  asserts every `resolved` URL starts with `https://registry.npmjs.org/`. This
  keeps internal mirror hostnames out of a public repo and guarantees external
  contributors and CI can install.
- **The registry is configured in exactly one place**,
  `.github/actions/setup-node/action.yml`, which every workflow consumes. The
  repo ships no `.npmrc` so contributors behind a corporate mirror are not
  overridden.
- **Transitive vulnerabilities are patched with version-scoped `overrides`.**
  Scoped keys (for example `brace-expansion@1`) are used deliberately: a blanket
  bump would drag a CommonJS consumer onto an ESM-only major and break the
  build.
- **Verify published versions against `https://registry.npmjs.org/<pkg>`
  directly.** `npm view` reads whichever registry is configured locally; a
  lagging mirror will misreport a version as unpublished.

### Known `npm audit` deviation

`npm audit` currently reports findings for `brace-expansion` via
[GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg). The
advisory declares a single flat range, `<= 5.0.7`, which semver-wise also covers
the maintainer's v1 and v2 backports. The versions installed here — `1.1.17`,
`2.1.3` and `5.0.8` — each contain the upstream commit
`fix: backport GHSA-mh99-v99m-4gvg`, so they are patched; the advisory metadata
simply has not been amended with the per-major ranges yet. `npm audit` is
therefore not wired into the CI gate. Re-check this note when the advisory is
updated.

## Response

We aim to acknowledge reports within a few days and to address confirmed issues
promptly, coordinating a release and disclosure with the reporter.
