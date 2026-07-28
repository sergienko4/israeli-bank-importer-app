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

## Response

We aim to acknowledge reports within a few days and to address confirmed issues
promptly, coordinating a release and disclosure with the reporter.
