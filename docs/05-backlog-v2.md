# Backlog V2

This backlog covers the next planning wave after the initial release package.

## B9 - Stabilization

### B9-01 - Crash cleanup
- Task: Fix the highest-impact crash paths in popup, sidebar, overlay, and diagnostics.
- Task: Remove stale state assumptions from session recovery.
- Acceptance Criteria: Common user flows recover without hard reloads.

### B9-02 - Browser compatibility
- Task: Verify current Chromium support targets.
- Task: Document any version-specific fallbacks.
- Acceptance Criteria: Unsupported behavior fails early and visibly.

### B9-03 - Regression triage
- Task: Turn repeated post-release issues into tracked fixes.
- Task: Capture the regression source, reproduction, and recovery path.
- Acceptance Criteria: Repeat failures become backlog items with clear ownership.

## B10 - UX Polish

### B10-01 - Caption readability
- Task: Refine overlay contrast, spacing, and density presets.
- Task: Keep the caption line easy to scan at a glance.
- Acceptance Criteria: Captions remain readable across supported meeting layouts.

### B10-02 - State copy
- Task: Tighten loading, empty, error, and recovery copy.
- Task: Remove redundant wording across surfaces.
- Acceptance Criteria: Users can tell what to do next in one sentence.

### B10-03 - Keyboard flow
- Task: Reduce unnecessary clicks in caption control flows.
- Task: Keep shortcuts and button labels consistent.
- Acceptance Criteria: Core actions are reachable without hunting through the UI.

## B11 - Operations

### B11-01 - Release hygiene
- Task: Standardize version bumps, tags, and release notes.
- Task: Keep release artifacts traceable to source commits.
- Acceptance Criteria: A shipped build can be mapped back to a commit and version.

### B11-02 - Support diagnostics
- Task: Extend local diagnostics for support handoff.
- Task: Keep all outputs local-only.
- Acceptance Criteria: Support can collect enough context without external tooling.

### B11-03 - Rollback drills
- Task: Define and rehearse rollback steps for bad releases.
- Task: Record the minimum communication required for a revert.
- Acceptance Criteria: Bad releases can be withdrawn without guesswork.

## B12 - Quality Gates

### B12-01 - Smoke automation
- Task: Automate the minimum startup and session checks.
- Task: Keep the smoke path fast enough for pre-merge use.
- Acceptance Criteria: A broken core flow fails before merge.

### B12-02 - Accessibility audit
- Task: Recheck keyboard, focus, and contrast after UI changes.
- Task: Record unresolved accessibility issues explicitly.
- Acceptance Criteria: Accessibility regressions are visible before release.

### B12-03 - Long-session stress
- Task: Validate sustained capture and storage under long meetings.
- Task: Watch for memory growth and recovery drift.
- Acceptance Criteria: Extended sessions remain stable.

## B13 - Product V2

### B13-01 - Transcript search
- Task: Add fast search across session history.
- Task: Keep results local and deterministic.
- Acceptance Criteria: Users can find prior captions without scanning every session.

### B13-02 - Export expansion
- Task: Add richer export formats and metadata.
- Task: Preserve plain-text export as the baseline.
- Acceptance Criteria: Exports fit more downstream workflows without losing simplicity.

### B13-03 - Multi-source capture
- Task: Explore new capture sources without breaking the current local-only model.
- Task: Keep each source explicit in the UI.
- Acceptance Criteria: Additional sources do not blur what is being captured.
