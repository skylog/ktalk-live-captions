# B9 Stabilization

This document covers the stabilization pass for B9 in the local-only release flow.
Work stays focused on crash cleanup, browser compatibility, and regression triage.

## Scope

- Stabilize the popup, sidebar, overlay, and diagnostics surfaces.
- Keep all recovery paths local and explicit.
- Fail early on unsupported browser behavior.
- Convert repeated post-release issues into tracked follow-up fixes.

## B9-01 Crash Cleanup

Tasks:

- Remove stale session assumptions in recovery paths.
- Fix the highest-impact crash paths in popup, sidebar, overlay, and diagnostics.
- Make reconnect and retry flows survive partial state loss without requiring a hard reload.

Acceptance criteria:

- Common user flows recover after service interruption or UI restart.
- No known crash path remains in the main caption surfaces.
- Recovery actions leave the transcript state intact or clearly reset it.

## B9-02 Browser Compatibility

Tasks:

- Verify the current Chromium support targets for extension, capture, and localhost integration.
- Document version-specific fallbacks where behavior differs.
- Block or explain unsupported flows instead of allowing silent failure.

Acceptance criteria:

- Supported Chromium versions run the caption flow without manual workarounds.
- Unsupported behavior fails early with a visible, local-only message.
- Browser-specific limits are documented in the repo before release.

## B9-03 Regression Triage

Tasks:

- Capture the source, reproduction steps, and recovery path for repeated failures.
- Separate product bugs from environment-specific issues.
- Convert repeat incidents into backlog items with clear ownership.

Acceptance criteria:

- Every repeated failure has a recorded reproduction and owner.
- Regression notes point to the affected surface and likely root cause.
- Stabilization work does not expand scope beyond B9.

## Execution Order

1. Triage crash cleanup first, starting with the surfaces that break core captioning.
2. Validate browser compatibility against the supported Chromium target.
3. Log any repeated failures as backlog items before moving to the next fix.

## Release Checks

- Confirm the extension starts in a clean Chromium profile.
- Confirm the local ASR connection is healthy before testing recovery.
- Re-run popup, overlay, sidebar, and diagnostics flows after each fix.
- Verify the final state in a local-only environment and keep release artifacts traceable to the commit.

