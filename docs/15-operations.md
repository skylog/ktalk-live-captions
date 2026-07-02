# B11 Operations

This document covers the operational pass for B11 in the local-only release flow.
Keep the work focused on release hygiene, support diagnostics, and rollback drills.

## Scope

- Keep releases traceable to a commit and a versioned artifact.
- Make local diagnostics good enough for support handoff without external tooling.
- Practice rollback so a bad release can be withdrawn quickly and predictably.

## B11-01 Release Hygiene

Tasks:

- Bump the version in the release source of truth before packaging.
- Tag the release from the commit that produced the shipped build.
- Record the build commit, version, and artifact location in release notes.
- Keep generated output tied to the exact source commit that created it.

Acceptance criteria:

- A shipped build can be mapped back to one commit and one version.
- Release notes identify the artifact, version, and source revision.
- Packaging steps do not depend on unpublished manual state.

## B11-02 Support Diagnostics

Tasks:

- Ensure diagnostics expose the local endpoint, health, session, and reconnect state.
- Keep diagnostics output local-only and safe to share in support handoff.
- Include the surface name, failure code, and short reason for common errors.
- Make the support path point to the minimum evidence needed to triage a release issue.

Acceptance criteria:

- Support can diagnose common release issues without external services.
- Diagnostics identify whether the problem is popup, overlay, sidebar, or service state.
- The output is specific enough to distinguish start, reconnect, export, and permission failures.

## B11-03 Rollback Drills

Tasks:

- Define the rollback trigger for a bad release before shipping.
- Practice reverting to the last known good version and tag.
- Verify the minimum communication needed for the rollback is documented.
- Confirm that rollback does not require product changes or external coordination.

Acceptance criteria:

- A bad release can be withdrawn without guesswork.
- The rollback path is documented as a short repeatable sequence.
- The team knows which release metadata to announce during a revert.

## Release Sequence

1. Confirm the version bump, tag target, and artifact commit.
2. Validate diagnostics output in a local-only environment.
3. Rehearse rollback from the current release to the previous known good release.
4. Ship only after the rollback path is clear and repeatable.

## Operational Notes

- Keep this document aligned with the release process and support runbook.
- Do not add cloud or external dependency assumptions.
- Treat diagnostics and rollback as release readiness checks, not afterthoughts.
