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
- OTP code handling in the app-based OTP flow, including SMS capture. The
  standard APK holds **no SMS permission** at all: it uses the SMS User Consent
  API, so the user approves each individual message in a system dialog and the app
  can read nothing else. A captured message body is parsed for
  digits and discarded in the same step — it is never stored, logged, or sent
  anywhere. Automatic submission is opt-in, bounded to one send per request, and
  cancellable.
- Opt-in **auto-read** trades that dialog for zero interaction and is the one
  path that uses `RECEIVE_SMS`. It is left out of the standard APK because Play
  Protect's enhanced fraud protection blocks internet-sideloaded apps with that
  permission on affected devices with Google Play services. Each release also
  carries a separate SMS APK, `israeli-bank-importer.sms.apk`, built with
  `OTP_SMS_AUTOREAD=1`, which alone carries the permission, receiver and service;
  it is installed over `adb`, including on affected devices where tapping a
  browser or files-app download is blocked. It is signed with the same key as
  the standard APK and must match its version, so the two can replace each
  other. Even in that build, it remains a runtime permission: nothing is granted
  until the user turns the switch on and approves Android's dialog, and the
  receiver is inert until then.
  Reports about it are in scope, in particular any way to make its receiver act
  on a message while the user has not opted in, to make it submit while no
  scrape is waiting for a code, or to reach it from another app.
  `READ_SMS` is blocked in every build.
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
therefore not wired into the CI gate. The matching Dependabot alert is dismissed
on the same evidence.

The same advisory reaches OpenSSF Scorecard's `Vulnerabilities` check through
OSV, so the exception is recorded once more, in machine-readable form, in
[`osv-scanner.toml`](osv-scanner.toml). That entry carries an `ignoreUntil`
date: when it lapses the finding returns on its own, which is the intended
prompt to re-read the advisory rather than renew the exception by habit.

### Dependabot automation

Dependabot pull requests merge themselves once CI is green.
[`dependabot-auto-merge.yml`](.github/workflows/dependabot-auto-merge.yml)
turns on squash auto-merge for every pull request Dependabot opens, for npm and
GitHub Actions alike, whether the update is a patch, a minor or a major. The
workflow never merges by itself: GitHub merges only once branch protection is
satisfied, and a red check leaves the pull request open for a human. The
required checks are `Typecheck, lint & bundle`, `SonarCloud Analysis` and
`CI Pass`, and `CI Pass` succeeds only when every job it aggregates in
[`ci.yml`](.github/workflows/ci.yml) succeeds: the build, `Expo SDK pin
drift`, `Documentation Quality`, `License Compliance` and `SonarCloud
Analysis`. CodeQL and Gitleaks also run on each pull request but are not
required, so a finding from either does not hold the merge back; review their
alerts in the Security tab.

The limits are deliberate:

- **The Expo SDK family is upgraded by hand.** `expo`, `expo-*`, `@expo/*`,
  `jest-expo` and `eslint-config-expo` are ignored for version updates in
  [`.github/dependabot.yml`](.github/dependabot.yml), as are the native pins
  the SDK chooses, such as `react` and `react-native`. The SDK moves these
  versions together, and `npx expo install --fix` is the only supported way to
  change them. The ignores list `update-types`, which apply to version updates
  only, so Dependabot security updates for these packages still open. Do not
  shorten them to a bare `dependency-name` entry: that blocks security updates
  as well.
- **Auto-merge follows Dependabot's own pushes only.** It is switched on only
  when Dependabot opened the pull request, pushed its head commit and started
  the run, and the call is pinned to that commit, so a slow run cannot enable
  it after someone else has pushed. Any other push to a Dependabot branch,
  including the "Update branch" button, switches auto-merge off, and a human
  merges that pull request.
- **SonarCloud does not analyse Dependabot pull requests.** Dependabot runs
  receive no Actions secrets, and no Dependabot secret holds `SONAR_TOKEN`, so
  the `sonar` job skips its scan steps and still concludes as a success. Both
  `SonarCloud Analysis` and `CI Pass` therefore pass without an analysis; the
  code is analysed on the next CI run on `main`.
- **Branch protection does not require an up-to-date branch** (`strict:
  false`). With that rule on, each merge would leave every other open
  Dependabot pull request behind `main`, and auto-merge would stall until
  someone rebased it. Dependabot rebases on its own when the lockfile
  conflicts, and linear history is still enforced. The cost is that two pull
  requests that each pass alone are never tested together, so their combined
  result first meets CI on `main`.
- **Merges do not start `push: main` workflows.** The merge is made with
  `GITHUB_TOKEN`, and GitHub starts no workflows from pushes that token makes.
  CI, CodeQL, Gitleaks, Scorecard and release-please therefore catch up on the
  next human push to `main`. To test `main` sooner after Dependabot merges,
  run CI by hand from the Actions tab or with
  `gh workflow run ci.yml --ref main`. release-please has no manual trigger on
  purpose: a run that finds a merged release pull request tags the release and
  starts the APK and OTA publishes, so only a real push should start one.
  Waiting costs nothing: release-please treats `chore` and `ci` commits as not
  user-facing and opens no release for them, and Dependabot writes only
  `chore(deps)`, `chore(deps-dev)` and `ci(deps)` commits here.
- **The SMS APK build is not part of the gate.** `sms-apk-check.yml` can run
  for over an hour and is not a required check, so a bump can merge before it
  finishes or after it fails. A break in the Gradle build would then first
  surface in `release-apk-sms.yml`. Before tagging a release that follows
  dependency bumps, confirm that `sms-apk-check.yml` passed on each of those
  Dependabot pull requests.

Some alerts have no fix that Dependabot can reach. They stay open on purpose:
each one closes on its own when an upstream release lets Dependabot propose a
patched version. Three have no patched release at all. The other two have one,
but only outside the range their parent declares, and forcing a version past
that range is the build break the scoped-`overrides` rule above exists to
avoid. So no `overrides` entry is added for any of them. As of October 2026 the
open alerts are:

| Alert | Package | Severity | Reached through | Waiting on |
| --- | --- | --- | --- | --- |
| [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | `node-forge` | high | Expo CLI code signing, `sonarqube-scanner` | a patched release |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | `braces` | high | `micromatch` in Metro, Jest and `markdownlint-cli2` | a patched release |
| [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) | `sprintf-js` | medium | `argparse@1` via `js-yaml@3` (dev) | a patched release |
| [GHSA-r4xh-jqrq-34v2](https://github.com/advisories/GHSA-r4xh-jqrq-34v2) | `smol-toml` | medium | `markdownlint-cli2`, which pins `1.8.0` (dev) | `markdownlint-cli2` accepting `1.9.0` |
| [GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7) | `katex` | low | `micromark-extension-math` via `markdownlint` (dev) | `micromark-extension-math` accepting `0.18` |

None of these packages is imported by the app or included in its JavaScript
bundle; they run only in build, test and lint tooling.

### Review policy

This project has a single maintainer, so a required-approval rule cannot be
satisfied: there is no second human to approve, and bot or AI approvals do not
count toward it. Enabling one would either block every merge or have to exempt
administrators, which removes the control it is meant to add. OpenSSF Scorecard
flags this as a `Code-Review` finding; the finding is accepted rather than
worked around.

Change review is instead enforced by what runs on every pull request, none of
which a maintainer can wave through:

- CodeQL (`security-and-quality`) and Gitleaks on each pull request.
- Type-check, strict lint at `--max-warnings=0`, Prettier, and the full Jest
  suite with coverage.
- The two supply-chain guards above, `lint:actions` and `lint:lockfile`, which
  also run locally on `pre-push`.

If a second maintainer joins, enable
`required_pull_request_reviews` with `required_approving_review_count: 1` and
`enforce_admins: true`, and delete this section.

## Response

We aim to acknowledge reports within a few days and to address confirmed issues
promptly, coordinating a release and disclosure with the reporter.
